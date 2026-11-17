import {
  evaluateClaimEvidence,
  type ClaimEvidenceSource,
  type ScriptClaim,
  type SourceType,
} from "@gta6/domain";

import type { createSupabaseServerClient } from "@/lib/supabase/server";

/** Source columns needed to judge a claim's evidence. */
export const EVIDENCE_SOURCE_COLUMNS =
  "id, publisher, source_type, trust_level, published_at, observed_at";

export interface EvidenceSourceRow {
  readonly publisher: string;
  readonly source_type: SourceType;
  readonly trust_level: number;
  readonly published_at: string | null;
  readonly observed_at: string;
}

/** Maps a sources row to the domain shape; feeds without a date fall back to when we saw it. */
export function toEvidenceSource(row: EvidenceSourceRow): ClaimEvidenceSource {
  return {
    publisher: row.publisher,
    sourceType: row.source_type,
    trustLevel: row.trust_level,
    publishedAt: new Date(row.published_at ?? row.observed_at),
  };
}

export const CERTAINTY_OPTIONS = [
  { value: "confirmed", label: "Confirmada (fuente oficial)" },
  { value: "reported", label: "Reportada (2+ medios fiables)" },
  { value: "rumor", label: "Rumor" },
  { value: "speculation", label: "Especulación" },
  { value: "opinion", label: "Opinión" },
] as const;

export const CERTAINTY_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  CERTAINTY_OPTIONS.map((option) => [option.value, option.label]),
);

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** Claims of an opportunity in the shape the script QA needs, evidence evaluated server-side. */
export async function loadScriptClaims(
  supabase: ServerClient,
  opportunityId: string,
): Promise<ScriptClaim[]> {
  const { data } = await supabase
    .from("claims")
    .select(
      `id, text, certainty, sensitive, verified_at, claim_sources(sources(${EVIDENCE_SOURCE_COLUMNS}))`,
    )
    .eq("opportunity_id", opportunityId)
    .order("created_at");
  return (data ?? []).map((claim) => ({
    id: claim.id,
    text: claim.text,
    certainty: claim.certainty,
    verified: claim.verified_at !== null,
    evidence: evaluateClaimEvidence({
      certainty: claim.certainty,
      sensitive: claim.sensitive,
      sources: claim.claim_sources.map(({ sources }) => toEvidenceSource(sources)),
    }),
  }));
}
