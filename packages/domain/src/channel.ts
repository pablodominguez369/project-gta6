import { z } from "zod";

/** Must match `public.platform` and `public.channel_mode` in supabase/migrations. */
export const PLATFORMS = ["youtube", "instagram", "tiktok", "simulated"] as const;
export const CHANNEL_MODES = ["draft", "approval", "autopublish", "manual"] as const;

export type Platform = (typeof PLATFORMS)[number];
export type ChannelMode = (typeof CHANNEL_MODES)[number];

/** Modes an operator may choose in Phase 1. Autopublish is blocked (also enforced in SQL). */
export const SELECTABLE_CHANNEL_MODES = ["draft", "approval", "manual"] as const;

export const DEFAULT_TIMEZONE = "Europe/Madrid";

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const createChannelInputSchema = z.object({
  platform: z.enum(PLATFORMS),
  displayName: z.string().trim().min(1).max(100),
  mode: z.enum(SELECTABLE_CHANNEL_MODES).default("draft"),
  timezone: z
    .string()
    .trim()
    .min(1)
    .default(DEFAULT_TIMEZONE)
    .refine(isValidTimeZone, { message: "Invalid IANA time zone" }),
  maxPostsPerDay: z.coerce.number().int().min(0).max(50).default(1),
  minMinutesBetweenPosts: z.coerce.number().int().min(0).max(10_080).default(120),
});

export type CreateChannelInput = z.infer<typeof createChannelInputSchema>;

/** Pausing always needs a reason, so the audit log explains every stop. */
export const pauseInputSchema = z.discriminatedUnion("paused", [
  z.object({ paused: z.literal(true), reason: z.string().trim().min(3).max(500) }),
  z.object({ paused: z.literal(false) }),
]);

export type PauseInput = z.infer<typeof pauseInputSchema>;
