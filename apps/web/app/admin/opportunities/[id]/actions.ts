"use server";

import { CLAIM_CERTAINTIES, CLAIM_ISSUE_MESSAGES, evaluateClaimEvidence } from "@gta6/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionError, actionOk, type ActionState } from "@/lib/action-state";
import { requireRole } from "@/lib/auth/require-role";
import { EVIDENCE_SOURCE_COLUMNS, toEvidenceSource, type EvidenceSourceRow } from "@/lib/claims";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const createClaimSchema = z.object({
  opportunityId: z.uuid(),
  text: z.string().trim().min(3).max(1000),
  certainty: z.enum(CLAIM_CERTAINTIES),
  sensitive: z.boolean(),
  sourceIds: z.array(z.uuid()).max(20),
});

/**
 * An editor records a claim with the sources that back it. The evidence rules (rule 4) are
 * checked here before anything is written; the database also refuses factual claims without
 * a source.
 */
export async function createClaim(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole(["admin", "editor"]);
  const parsed = createClaimSchema.safeParse({
    opportunityId: formData.get("opportunityId"),
    text: formData.get("text"),
    certainty: formData.get("certainty"),
    sensitive: formData.get("sensitive") === "on",
    sourceIds: formData.getAll("sourceIds"),
  });
  if (!parsed.success) return actionError("Revisa el texto (3 a 1000 caracteres) y la certeza.");
  const { opportunityId, text, certainty, sensitive, sourceIds } = parsed.data;

  const supabase = await createSupabaseServerClient();
  let sources: EvidenceSourceRow[] = [];
  if (sourceIds.length > 0) {
    const { data, error } = await supabase
      .from("sources")
      .select(EVIDENCE_SOURCE_COLUMNS)
      .in("id", sourceIds);
    if (error || data.length !== new Set(sourceIds).size) {
      return actionError("Alguna de las fuentes no existe.");
    }
    sources = data;
  }

  const evidence = evaluateClaimEvidence({
    certainty,
    sensitive,
    sources: sources.map(toEvidenceSource),
  });
  if (!evidence.ok) {
    return actionError(evidence.issues.map((issue) => CLAIM_ISSUE_MESSAGES[issue]).join(" "));
  }

  const { error } = await supabase.rpc("create_claim", {
    p_opportunity_id: opportunityId,
    p_text: text,
    p_certainty: certainty,
    p_sensitive: sensitive,
    p_source_ids: sourceIds,
  });
  if (error) {
    logger.error({ dbErrorCode: error.code }, "claim creation failed");
    return actionError("No se pudo guardar la afirmación.");
  }
  revalidatePath(`/admin/opportunities/${opportunityId}`);
  return actionOk("Afirmación guardada. Falta que otra persona la verifique.");
}

const verifySchema = z.object({ claimId: z.uuid() });

/** A second editor confirms the claim matches its sources. Never the author (also a DB check). */
export async function verifyClaim(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireRole(["admin", "editor"]);
  const parsed = verifySchema.safeParse({ claimId: formData.get("claimId") });
  if (!parsed.success) return actionError("Afirmación no válida.");

  const supabase = await createSupabaseServerClient();
  const { data: claim } = await supabase
    .from("claims")
    .select(
      `id, opportunity_id, certainty, sensitive, created_by, claim_sources(sources(${EVIDENCE_SOURCE_COLUMNS}))`,
    )
    .eq("id", parsed.data.claimId)
    .maybeSingle();
  if (!claim) return actionError("La afirmación no existe.");
  if (claim.created_by === user.id) {
    return actionError("No puedes verificar una afirmación que has escrito tú.");
  }

  const evidence = evaluateClaimEvidence({
    certainty: claim.certainty,
    sensitive: claim.sensitive,
    sources: claim.claim_sources.map(({ sources }) => toEvidenceSource(sources)),
  });
  if (!evidence.ok) {
    return actionError(evidence.issues.map((issue) => CLAIM_ISSUE_MESSAGES[issue]).join(" "));
  }

  const { error } = await supabase
    .from("claims")
    .update({ verified_at: new Date().toISOString(), verified_by: user.id })
    .eq("id", claim.id);
  if (error) {
    logger.error({ dbErrorCode: error.code }, "claim verification failed");
    return actionError("No se pudo verificar la afirmación.");
  }
  revalidatePath(`/admin/opportunities/${claim.opportunity_id}`);
  return actionOk("Afirmación verificada.");
}
