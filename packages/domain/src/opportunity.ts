import type { ClaimCertainty, SourceType } from "./editorial";

/** Window in which reports about the same event are grouped into one opportunity. */
export const CLUSTER_WINDOW_HOURS = 72;
/** Title similarity (0 to 1) at or above which two sources are treated as the same story. */
export const SAME_STORY_THRESHOLD = 0.5;
/** An opportunity stops being timely this long after its latest source. */
export const RELEVANCE_HOURS = 72;

/** Lower case, no accents, no punctuation, single spaces. */
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

function trigrams(text: string): Set<string> {
  const grams = new Set<string>();
  for (const word of normalizeTitle(text).split(" ")) {
    if (word.length === 0) continue;
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i += 1) grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

/** Trigram similarity in [0, 1], like Postgres pg_trgm: shared / union of trigram sets. */
export function titleSimilarity(a: string, b: string): number {
  const left = trigrams(a);
  const right = trigrams(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return shared / (left.size + right.size - shared);
}

export interface ClusterCandidate {
  readonly opportunityId: string;
  readonly titles: readonly string[];
}

/** The existing opportunity a new source belongs to, or null to start a new one. */
export function findCluster(title: string, candidates: readonly ClusterCandidate[]): string | null {
  let best: { id: string; score: number } | null = null;
  for (const candidate of candidates) {
    const score = Math.max(0, ...candidate.titles.map((other) => titleSimilarity(title, other)));
    if (score >= SAME_STORY_THRESHOLD && (best === null || score > best.score)) {
      best = { id: candidate.opportunityId, score };
    }
  }
  return best?.id ?? null;
}

export interface EvidenceSource {
  readonly publisher: string;
  readonly sourceType: SourceType;
  /** 0 unknown, 1 community, 2 established press, 3 official/primary. */
  readonly trustLevel: number;
  readonly title: string;
  readonly excerpt: string | null;
  readonly publishedAt: Date | null;
  readonly observedAt: Date;
}

export const RISK_FLAGS = ["leak", "spoiler", "single_source", "unknown_provenance"] as const;
export type RiskFlag = (typeof RISK_FLAGS)[number];

/** Words that suggest leaked or unauthorized material. Matching opportunities are discarded (rule 3). */
const LEAK_TERMS = [
  "filtracion",
  "filtrado",
  "filtrada",
  "filtrados",
  "filtradas",
  "leak",
  "leaked",
  "leaks",
  "datamine",
  "datamined",
  "dataminer",
  "build interna",
  "internal build",
];
const SPOILER_TERMS = ["spoiler", "spoilers", "final del juego", "ending"];

function mentions(text: string, terms: readonly string[]): boolean {
  const normalized = ` ${normalizeTitle(text)} `;
  return terms.some((term) => normalized.includes(` ${term} `));
}

/** Whether a text mentions leak or spoiler vocabulary (whole words, accents ignored). */
export function findRiskTerms(text: string): { readonly leak: boolean; readonly spoiler: boolean } {
  return { leak: mentions(text, LEAK_TERMS), spoiler: mentions(text, SPOILER_TERMS) };
}

export interface OpportunityAssessment {
  readonly certainty: ClaimCertainty;
  readonly score: number;
  readonly riskFlags: readonly RiskFlag[];
  readonly expiresAt: Date;
  /** Set when the opportunity must be discarded automatically, with the reason to record. */
  readonly discardReason: string | null;
}

const HOUR = 3_600_000;

/**
 * Evidence level, risk and timeliness of a story from its sources. Popularity is not evidence:
 * the score ranks what to look at first; the certainty says what may be stated.
 *
 * - confirmed: at least one official/primary source (trust 3 or type "official").
 * - reported: two or more independent reliable publishers (trust >= 2).
 * - rumor: anything else.
 */
export function assessOpportunity(
  sources: readonly EvidenceSource[],
  now: Date,
): OpportunityAssessment {
  const official = sources.some((s) => s.trustLevel >= 3 || s.sourceType === "official");
  const reliablePublishers = new Set(
    sources.filter((s) => s.trustLevel >= 2).map((s) => s.publisher.trim().toLowerCase()),
  );
  const publishers = new Set(sources.map((s) => s.publisher.trim().toLowerCase()));
  const certainty: ClaimCertainty = official
    ? "confirmed"
    : reliablePublishers.size >= 2
      ? "reported"
      : "rumor";

  const flags: RiskFlag[] = [];
  const text = sources.map((s) => `${s.title} ${s.excerpt ?? ""}`).join(" ");
  if (mentions(text, LEAK_TERMS)) flags.push("leak");
  if (mentions(text, SPOILER_TERMS)) flags.push("spoiler");
  if (publishers.size <= 1) flags.push("single_source");
  if (sources.every((s) => s.trustLevel === 0)) flags.push("unknown_provenance");

  const latest = Math.max(0, ...sources.map((s) => (s.publishedAt ?? s.observedAt).getTime()));
  const ageHours = Math.max(0, (now.getTime() - latest) / HOUR);
  const freshness = 40 * Math.max(0, 1 - ageHours / RELEVANCE_HOURS);
  const coverage = Math.min(30, 10 * publishers.size);
  const trust = 10 * Math.max(0, ...sources.map((s) => Math.min(3, s.trustLevel)));
  const penalty = (certainty === "rumor" ? 20 : 0) + (flags.includes("spoiler") ? 10 : 0);
  const score =
    Math.round(Math.max(0, Math.min(100, freshness + coverage + trust - penalty)) * 100) / 100;

  return {
    certainty,
    score,
    riskFlags: flags,
    expiresAt: new Date(latest + RELEVANCE_HOURS * HOUR),
    discardReason: flags.includes("leak")
      ? "Descartada automáticamente: posible filtración o material no autorizado"
      : null,
  };
}
