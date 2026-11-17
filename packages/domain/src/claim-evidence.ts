import { isFactual, type ClaimCertainty, type SourceType } from "./editorial";

/** The parts of a source that decide how much a claim can lean on it. */
export interface ClaimEvidenceSource {
  readonly publisher: string;
  readonly sourceType: SourceType;
  /** 0 unknown, 1 community, 2 established press, 3 official/primary. */
  readonly trustLevel: number;
  /** Publication date of the source, or when we first saw it when the feed gives none. */
  readonly publishedAt: Date | null;
}

export interface ClaimEvidenceInput {
  readonly certainty: ClaimCertainty;
  readonly sensitive: boolean;
  readonly sources: readonly ClaimEvidenceSource[];
}

export const CLAIM_ISSUES = [
  /** confirmed without an official/primary source. */
  "needs_official_source",
  /** reported without two independent reliable publishers (or an official source). */
  "needs_two_reliable_sources",
  /** Sensitive claim backed by a single non-official source: alert, never state it. */
  "sensitive_single_source",
  /** A factual or sensitive claim with no source at all. */
  "missing_source",
  /** No source has a date, so the claim cannot be dated on air. */
  "undated",
] as const;
export type ClaimIssue = (typeof CLAIM_ISSUES)[number];

export interface ClaimEvidence {
  /** The strongest certainty the sources support. */
  readonly supportedCertainty: ClaimCertainty;
  /** True when the declared certainty is backed by the sources (rule 4). */
  readonly ok: boolean;
  readonly issues: readonly ClaimIssue[];
  /** Rumors, speculation and opinion must be labelled as such wherever they are used. */
  readonly mustBeLabelled: boolean;
  /** Most recent source date, to say "según X, el <fecha>". */
  readonly latestSourceDate: Date | null;
}

const isOfficial = (s: ClaimEvidenceSource): boolean =>
  s.trustLevel >= 3 || s.sourceType === "official";

const publisherKey = (s: ClaimEvidenceSource): string => s.publisher.trim().toLowerCase();

/**
 * Checks a claim against its sources. Same scale as the opportunity assessment:
 *
 * - confirmed: at least one official/primary source.
 * - reported: two or more independent reliable publishers (trust >= 2), or an official source.
 * - sensitive (rumors about people, dates, money, health...): needs an official source or two
 *   independent reliable publishers, whatever certainty is declared; one non-official source
 *   raises `sensitive_single_source`.
 * - rumor, speculation, opinion: no source required, but they are always labelled.
 *
 * Pure function: the web app runs it before saving or verifying a claim, and the script QA runs
 * it again on every claim a script cites, so a claim written around the app is still caught.
 */
export function evaluateClaimEvidence(input: ClaimEvidenceInput): ClaimEvidence {
  const { certainty, sensitive, sources } = input;
  const official = sources.some(isOfficial);
  const reliablePublishers = new Set(sources.filter((s) => s.trustLevel >= 2).map(publisherKey));
  const publishers = new Set(sources.map(publisherKey));
  const supportedCertainty: ClaimCertainty = official
    ? "confirmed"
    : reliablePublishers.size >= 2
      ? "reported"
      : "rumor";

  const issues: ClaimIssue[] = [];
  if (isFactual(certainty) && sources.length === 0) issues.push("missing_source");
  if (certainty === "confirmed" && sources.length > 0 && !official) {
    issues.push("needs_official_source");
  }
  if (certainty === "reported" && sources.length > 0 && supportedCertainty === "rumor") {
    issues.push("needs_two_reliable_sources");
  }
  if (sensitive && !official && reliablePublishers.size < 2) {
    const issue: ClaimIssue =
      publishers.size === 1
        ? "sensitive_single_source"
        : sources.length === 0
          ? "missing_source"
          : "needs_two_reliable_sources";
    if (!issues.includes(issue)) issues.push(issue);
  }

  const dates = sources
    .map((s) => s.publishedAt?.getTime())
    .filter((t): t is number => t !== undefined);
  const latestSourceDate = dates.length > 0 ? new Date(Math.max(...dates)) : null;
  if (isFactual(certainty) && sources.length > 0 && latestSourceDate === null) {
    issues.push("undated");
  }

  return {
    supportedCertainty,
    ok: issues.length === 0,
    issues,
    mustBeLabelled: !isFactual(certainty),
    latestSourceDate,
  };
}

/** Plain-language explanation of each issue, for the admin panel (Spanish product copy). */
export const CLAIM_ISSUE_MESSAGES: Readonly<Record<ClaimIssue, string>> = {
  needs_official_source: "«Confirmada» necesita una fuente oficial o primaria.",
  needs_two_reliable_sources: "Necesita dos medios fiables independientes o una fuente oficial.",
  sensitive_single_source:
    "Afirmación sensible con una sola fuente no oficial: no se puede afirmar.",
  missing_source: "Necesita al menos una fuente.",
  undated: "Ninguna fuente tiene fecha: no se puede fechar la afirmación.",
};
