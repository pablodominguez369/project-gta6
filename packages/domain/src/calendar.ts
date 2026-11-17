import { z } from "zod";

import { DomainError } from "./errors";
import { localDate } from "./publication";
import { err, ok, type Result } from "./result";

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** A weekly window in the rule's local time. ISO weekday: 1 = Monday ... 7 = Sunday. */
export const scheduleWindowSchema = z
  .strictObject({
    weekday: z.int().min(1).max(7),
    start: z.string().regex(TIME),
    end: z.string().regex(TIME),
  })
  .refine((window) => window.start < window.end, "start must be before end");
export type ScheduleWindow = z.infer<typeof scheduleWindowSchema>;

export const scheduleWindowsSchema = z.array(scheduleWindowSchema).max(50);

const WEEKDAYS: Readonly<Record<string, number>> = {
  lun: 1,
  mar: 2,
  mie: 3,
  jue: 4,
  vie: 5,
  sab: 6,
  dom: 7,
};

/**
 * Parses the admin's text format, one window per line: `lun 09:00-11:30` (weekday as a number 1-7
 * or a Spanish abbreviation). Empty lines are ignored.
 */
export function parseScheduleWindows(text: string): Result<ScheduleWindow[], DomainError> {
  const windows: ScheduleWindow[] = [];
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  for (const [index, line] of lines.entries()) {
    if (line.length === 0) continue;
    const match = /^(\S+)\s+(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/.exec(line);
    const day = match?.[1]
      ?.normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .slice(0, 3);
    const weekday = day === undefined ? undefined : (WEEKDAYS[day] ?? Number(day));
    const parsed = scheduleWindowSchema.safeParse({ weekday, start: match?.[2], end: match?.[3] });
    if (!parsed.success) {
      return err(
        new DomainError("VALIDATION_FAILED", "Invalid schedule window", {
          details: { line: index + 1 },
        }),
      );
    }
    windows.push(parsed.data);
  }
  return ok(windows);
}

export function formatScheduleWindows(windows: readonly ScheduleWindow[]): string {
  const names = ["", "lun", "mar", "mie", "jue", "vie", "sab", "dom"];
  return windows
    .map((w) => `${names[w.weekday] ?? String(w.weekday)} ${w.start}-${w.end}`)
    .join("\n");
}

interface WallTime {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function wallTimeOf(instant: Date, timezone: string): WallTime {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
    formatters.set(timezone, formatter);
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/** Minutes the zone is ahead of UTC at `utcMs`. */
function offsetMinutes(utcMs: number, timezone: string): number {
  const wall = wallTimeOf(new Date(utcMs), timezone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  return Math.round((asUtc - Math.floor(utcMs / 60_000) * 60_000) / 60_000);
}

/**
 * The UTC instant of a local wall time, using the IANA database (no fixed offsets).
 * - Time that does not exist (clocks jump forward, e.g. 02:30 on 2026-03-29 in Madrid): null.
 * - Time that happens twice (clocks go back, e.g. 02:30 on 2026-10-25 in Madrid): the first one.
 */
export function zonedTimeToUtc(wall: WallTime, timezone: string): Date | null {
  const wallMs = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const offsets = new Set([
    offsetMinutes(wallMs - 86_400_000, timezone),
    offsetMinutes(wallMs + 86_400_000, timezone),
  ]);
  const candidates = [...offsets]
    .map((offset) => wallMs - offset * 60_000)
    .filter((utcMs) => {
      const back = wallTimeOf(new Date(utcMs), timezone);
      return back.hour === wall.hour && back.minute === wall.minute && back.day === wall.day;
    })
    .sort((a, b) => a - b);
  const first = candidates[0];
  return first === undefined ? null : new Date(first);
}

export interface SlotInput {
  readonly windows: readonly ScheduleWindow[];
  readonly timezone: string;
  readonly now: Date;
  /** How many local days to look ahead, starting today. */
  readonly days: number;
  readonly maxPostsPerDay: number;
  readonly minMinutesBetweenPosts: number;
  /** Instants already taken on this channel (scheduled or published publications). */
  readonly taken: readonly Date[];
}

export interface ProposedSlot {
  readonly startsAt: Date;
  /** YYYY-MM-DD in the rule's time zone. */
  readonly localDate: string;
  /** HH:MM in the rule's time zone. */
  readonly localTime: string;
}

/** Granularity used to look for the next free time inside a window. */
const STEP_MINUTES = 15;
const MAX_SLOTS = 100;

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Proposes publication slots from a channel's weekly windows. Nothing is published or reserved:
 * the editor picks a slot. Each slot respects the channel's frequency limits (posts per local day
 * and minimum gap, counting already taken instants) and is in the future. Windows are read in the
 * rule's own time zone, so they keep their local hour across DST changes.
 */
export function proposeSlots(input: SlotInput): ProposedSlot[] {
  const chosen: Date[] = [];
  const result: ProposedSlot[] = [];
  const gapMs = input.minMinutesBetweenPosts * 60_000;
  const today = wallTimeOf(input.now, input.timezone);
  const perDay = new Map<string, number>();
  for (const instant of input.taken) {
    const day = localDate(instant, input.timezone);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }

  for (let offset = 0; offset < input.days && result.length < MAX_SLOTS; offset += 1) {
    // Calendar arithmetic on the local date only (no time component), so DST cannot shift it.
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    const weekday = ((date.getUTCDay() + 6) % 7) + 1;
    const ymd = {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    };
    const dayKey = `${String(ymd.year)}-${pad(ymd.month)}-${pad(ymd.day)}`;
    const windows = input.windows
      .filter((window) => window.weekday === weekday)
      .sort((a, b) => a.start.localeCompare(b.start));

    for (const window of windows) {
      const [startH, startM] = window.start.split(":").map(Number) as [number, number];
      const [endH, endM] = window.end.split(":").map(Number) as [number, number];
      for (
        let minutes = startH * 60 + startM;
        minutes < endH * 60 + endM && result.length < MAX_SLOTS;
        minutes += STEP_MINUTES
      ) {
        if ((perDay.get(dayKey) ?? 0) >= input.maxPostsPerDay) break;
        const instant = zonedTimeToUtc(
          { ...ymd, hour: Math.floor(minutes / 60), minute: minutes % 60 },
          input.timezone,
        );
        if (instant === null || instant <= input.now) continue;
        const tooClose = [...input.taken, ...chosen].some(
          (other) => Math.abs(other.getTime() - instant.getTime()) < gapMs,
        );
        if (tooClose) continue;
        chosen.push(instant);
        perDay.set(dayKey, (perDay.get(dayKey) ?? 0) + 1);
        result.push({
          startsAt: instant,
          localDate: dayKey,
          localTime: `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`,
        });
      }
    }
  }
  return result;
}
