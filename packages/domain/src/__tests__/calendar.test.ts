import { describe, expect, it } from "vitest";

import {
  formatScheduleWindows,
  parseScheduleWindows,
  proposeSlots,
  zonedTimeToUtc,
  type SlotInput,
} from "../calendar";

const MADRID = "Europe/Madrid";

describe("zonedTimeToUtc", () => {
  it("uses CET in winter and CEST in summer", () => {
    expect(zonedTimeToUtc({ year: 2026, month: 1, day: 15, hour: 10, minute: 0 }, MADRID)).toEqual(
      new Date("2026-01-15T09:00:00Z"),
    );
    expect(zonedTimeToUtc({ year: 2026, month: 7, day: 15, hour: 10, minute: 0 }, MADRID)).toEqual(
      new Date("2026-07-15T08:00:00Z"),
    );
  });

  it("returns null for a time skipped when clocks go forward (2026-03-29)", () => {
    expect(
      zonedTimeToUtc({ year: 2026, month: 3, day: 29, hour: 2, minute: 30 }, MADRID),
    ).toBeNull();
    expect(zonedTimeToUtc({ year: 2026, month: 3, day: 29, hour: 3, minute: 0 }, MADRID)).toEqual(
      new Date("2026-03-29T01:00:00Z"),
    );
  });

  it("picks the first occurrence of a repeated time when clocks go back (2026-10-25)", () => {
    expect(zonedTimeToUtc({ year: 2026, month: 10, day: 25, hour: 2, minute: 30 }, MADRID)).toEqual(
      new Date("2026-10-25T00:30:00Z"),
    );
    expect(zonedTimeToUtc({ year: 2026, month: 10, day: 25, hour: 3, minute: 30 }, MADRID)).toEqual(
      new Date("2026-10-25T02:30:00Z"),
    );
  });

  it("works for other zones (Mexico City has no DST)", () => {
    expect(
      zonedTimeToUtc({ year: 2026, month: 7, day: 1, hour: 9, minute: 0 }, "America/Mexico_City"),
    ).toEqual(new Date("2026-07-01T15:00:00Z"));
  });
});

const base: SlotInput = {
  windows: [],
  timezone: MADRID,
  now: new Date("2026-03-27T00:00:00Z"), // Friday
  days: 4,
  maxPostsPerDay: 3,
  minMinutesBetweenPosts: 60,
  taken: [],
};

describe("proposeSlots", () => {
  it("keeps the local hour across the spring DST change", () => {
    const slots = proposeSlots({
      ...base,
      windows: [6, 7, 1].map((weekday) => ({ weekday, start: "10:00", end: "10:15" })),
    });
    expect(slots.map((s) => [s.localDate, s.localTime, s.startsAt.toISOString()])).toEqual([
      ["2026-03-28", "10:00", "2026-03-28T09:00:00.000Z"], // Saturday, CET
      ["2026-03-29", "10:00", "2026-03-29T08:00:00.000Z"], // Sunday, CEST from 02:00
      ["2026-03-30", "10:00", "2026-03-30T08:00:00.000Z"],
    ]);
  });

  it("never proposes a time that does not exist on 2026-03-29", () => {
    const slots = proposeSlots({
      ...base,
      windows: [{ weekday: 7, start: "02:00", end: "03:30" }],
      minMinutesBetweenPosts: 15,
      maxPostsPerDay: 10,
    });
    expect(slots.map((s) => s.localTime)).toEqual(["03:00", "03:15"]);
  });

  it("proposes the repeated hour only once on 2026-10-25", () => {
    const slots = proposeSlots({
      ...base,
      now: new Date("2026-10-24T12:00:00Z"),
      days: 2,
      windows: [{ weekday: 7, start: "02:00", end: "03:00" }],
      minMinutesBetweenPosts: 30,
      maxPostsPerDay: 10,
    });
    expect(slots.map((s) => [s.localTime, s.startsAt.toISOString()])).toEqual([
      ["02:00", "2026-10-25T00:00:00.000Z"],
      ["02:30", "2026-10-25T00:30:00.000Z"],
    ]);
  });

  it("respects posts per local day and the minimum gap, counting taken instants", () => {
    const slots = proposeSlots({
      ...base,
      days: 1,
      now: new Date("2026-03-27T06:00:00Z"),
      windows: [{ weekday: 5, start: "09:00", end: "13:00" }],
      maxPostsPerDay: 2,
      minMinutesBetweenPosts: 90,
      taken: [new Date("2026-03-27T08:30:00Z")], // 09:30 local
    });
    // 09:00 and 10:00 are within 90 min of 09:30; 11:00 is the first free; then the day is full.
    expect(slots.map((s) => s.localTime)).toEqual(["11:00"]);
  });

  it("skips slots in the past", () => {
    const slots = proposeSlots({
      ...base,
      days: 1,
      now: new Date("2026-03-27T09:20:00Z"), // 10:20 local
      windows: [{ weekday: 5, start: "10:00", end: "12:00" }],
    });
    expect(slots[0]?.localTime).toBe("10:30");
  });
});

describe("parseScheduleWindows", () => {
  it("parses Spanish weekday names and numbers", () => {
    const result = parseScheduleWindows("lun 09:00-11:30\n\n7 18:00 - 20:00\nMié 12:00-13:00");
    expect(result.ok && result.value).toEqual([
      { weekday: 1, start: "09:00", end: "11:30" },
      { weekday: 7, start: "18:00", end: "20:00" },
      { weekday: 3, start: "12:00", end: "13:00" },
    ]);
    if (result.ok) {
      expect(formatScheduleWindows(result.value)).toBe(
        "lun 09:00-11:30\ndom 18:00-20:00\nmie 12:00-13:00",
      );
    }
  });

  it("reports the first invalid line", () => {
    const result = parseScheduleWindows("lun 09:00-11:00\nvie 12:00-11:00");
    expect(!result.ok && result.error.details).toEqual({ line: 2 });
    expect(parseScheduleWindows("xyz 09:00-10:00").ok).toBe(false);
    expect(parseScheduleWindows("lun 25:00-26:00").ok).toBe(false);
  });
});
