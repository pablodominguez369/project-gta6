/**
 * Editorial vocabulary (Phase 2). Each list must match its Postgres enum in
 * supabase/migrations/20261118100*; a test compares them with the generated database types.
 */
export const SOURCE_TYPES = ["official", "press", "community", "social"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const CLAIM_CERTAINTIES = [
  "confirmed",
  "reported",
  "rumor",
  "speculation",
  "opinion",
] as const;
export type ClaimCertainty = (typeof CLAIM_CERTAINTIES)[number];

export const OPPORTUNITY_STATUSES = [
  "new",
  "shortlisted",
  "accepted",
  "discarded",
  "expired",
] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export const SCRIPT_STATUSES = [
  "draft",
  "in_review",
  "changes_requested",
  "approved",
  "rejected",
] as const;
export type ScriptStatus = (typeof SCRIPT_STATUSES)[number];

export const SCRIPT_REQUEST_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "blocked",
  "failed",
] as const;
export type ScriptRequestStatus = (typeof SCRIPT_REQUEST_STATUSES)[number];

export const SCRIPT_LOCALES = ["es-ES", "es-419"] as const;
export type ScriptLocale = (typeof SCRIPT_LOCALES)[number];

/** Certainties a script may state as fact. Anything else must be labelled on air. */
export function isFactual(certainty: ClaimCertainty): boolean {
  return certainty === "confirmed" || certainty === "reported";
}

/** Maximum characters of a third-party excerpt we keep (also a CHECK in SQL). */
export const MAX_EXCERPT_LENGTH = 300;
