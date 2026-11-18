import { z } from "zod";

import { DomainError, type ErrorCode } from "./errors";
import { err, ok, type Result } from "./result";

/** Must match `public.publication_status`. */
export const PUBLICATION_STATUSES = [
  "queued",
  "in_progress",
  "succeeded",
  "failed",
  "ambiguous",
  "blocked",
  /** Gates passed on a manual channel; a person uploads the package by hand (T30). */
  "awaiting_manual",
] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

const TRANSITIONS: Readonly<Record<PublicationStatus, readonly PublicationStatus[]>> = {
  queued: ["in_progress", "blocked"],
  blocked: ["in_progress", "blocked", "queued"],
  in_progress: ["succeeded", "failed", "ambiguous", "in_progress", "blocked", "awaiting_manual"],
  // An ambiguous publication is resolved through reconciliation. It may be blocked by a pause;
  // `reconcile_required` keeps the next attempt reconciling first.
  ambiguous: ["in_progress", "succeeded", "failed", "ambiguous", "blocked"],
  // Completed by a person (complete_manual_publication) or abandoned.
  awaiting_manual: ["succeeded", "failed"],
  succeeded: [],
  failed: [],
};

export function isTerminal(status: PublicationStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export function canTransition(from: PublicationStatus, to: PublicationStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Content of `publications.payload_json`. Validated when enqueuing (web) and again by the worker
 * before calling any publisher. `mediaRef` points to our own storage, never to a signed URL.
 */
export const publicationPayloadSchema = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().max(5_000),
  mediaRef: z.string().min(1).max(500),
  /** Declared to the platform when the video uses a synthetic voice (rule 5). */
  syntheticMedia: z.boolean().default(false),
  /**
   * The person queuing chose the (private) visibility explicitly. TikTok's UX rules require it
   * for every post, with no default; the TikTok adapter refuses a request without it.
   */
  visibilityConfirmed: z.boolean().default(false),
});
export type PublicationPayload = z.infer<typeof publicationPayloadSchema>;

/**
 * Whether an earlier attempt may have reached the platform. If so, the external state MUST be
 * reconciled before publishing again (rule 7).
 */
export function mayHaveReachedPlatform(status: PublicationStatus): boolean {
  return status === "in_progress" || status === "ambiguous";
}

export const PUBLISHING_MODES = ["simulated", "live"] as const;
export type PublishingMode = (typeof PUBLISHING_MODES)[number];

export interface GateInput {
  readonly systemPaused: boolean;
  readonly channelPaused: boolean;
  readonly platform: string;
  /** Worker setting. "live" is only accepted outside local development (config). */
  readonly publishingMode: PublishingMode;
  /** Channel switch set by an admin with a reason (ADR 0005). */
  readonly liveUploadsEnabled: boolean;
  /** Channel mode; manual channels never call a platform, so they skip the live keys. */
  readonly channelMode: string;
  /** The channel has an active, unexpired credential reference. */
  readonly credentialActive: boolean;
}

/**
 * Pre-publication gates, checked on every attempt (not only when enqueuing), so a pause applied
 * after a job was queued still stops it. A real platform needs three keys (ADR 0005): the
 * worker in live mode, the channel switch and an active credential. Visibility is enforced
 * separately: Phase 4 only uploads as private.
 */
export function evaluatePublishGates(input: GateInput): Result<true, DomainError> {
  if (input.systemPaused) {
    return err(new DomainError("SYSTEM_PAUSED", "Global pause is active"));
  }
  if (input.channelPaused) {
    return err(new DomainError("CHANNEL_PAUSED", "Channel is paused"));
  }
  // Manual channels and the simulator never reach a real platform from the worker.
  if (input.channelMode === "manual" || input.platform === "simulated") return ok(true);
  if (input.publishingMode !== "live") {
    // Development and CI never reach a real platform (rule 1).
    return err(new DomainError("FORBIDDEN", "Real uploads are disabled in this worker"));
  }
  if (!input.liveUploadsEnabled) {
    return err(new DomainError("FORBIDDEN", "Real uploads are not enabled for this channel"));
  }
  if (!input.credentialActive) {
    return err(new DomainError("CREDENTIAL_EXPIRED", "The channel has no active credential"));
  }
  return ok(true);
}

export interface FrequencyInput {
  readonly now: Date;
  /** IANA zone of the channel; "per day" means the channel's local calendar day. */
  readonly timezone: string;
  readonly maxPostsPerDay: number;
  readonly minMinutesBetweenPosts: number;
  /** published_at of the channel's recent successful publications. */
  readonly recentPublishedAt: readonly Date[];
}

/** YYYY-MM-DD of `date` in `timezone`. DST-safe because it relies on the IANA database. */
export function localDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Frequency limits are never raised automatically (rule 8); a breach blocks the attempt. */
export function checkFrequency(input: FrequencyInput): Result<true, DomainError> {
  const today = localDate(input.now, input.timezone);
  const publishedToday = input.recentPublishedAt.filter(
    (date) => localDate(date, input.timezone) === today,
  ).length;
  if (publishedToday >= input.maxPostsPerDay) {
    return err(
      new DomainError("RATE_LIMITED", "Daily publication limit reached", {
        details: { publishedToday, maxPostsPerDay: input.maxPostsPerDay },
      }),
    );
  }

  const latest = Math.max(0, ...input.recentPublishedAt.map((date) => date.getTime()));
  const minutesSinceLatest = (input.now.getTime() - latest) / 60_000;
  if (latest > 0 && minutesSinceLatest < input.minMinutesBetweenPosts) {
    return err(
      new DomainError("RATE_LIMITED", "Minimum time between publications not reached", {
        details: {
          minutesSinceLatest: Math.floor(minutesSinceLatest),
          minMinutesBetweenPosts: input.minMinutesBetweenPosts,
        },
      }),
    );
  }
  return ok(true);
}

/** Codes that stop the attempt without failing the publication: it stays blocked and retryable later. */
export const BLOCKING_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "SYSTEM_PAUSED",
  "CHANNEL_PAUSED",
  "RATE_LIMITED",
]);
