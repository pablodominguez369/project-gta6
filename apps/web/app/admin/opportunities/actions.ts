"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionError, actionOk, type ActionState } from "@/lib/action-state";
import { requireRole } from "@/lib/auth/require-role";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const decisionSchema = z.object({
  opportunityId: z.uuid(),
  decision: z.enum(["shortlisted", "accepted", "discarded"]),
  reason: z.string().trim().max(1000).optional(),
});

const MESSAGES = {
  shortlisted: "Oportunidad preseleccionada.",
  accepted: "Oportunidad aceptada.",
  discarded: "Oportunidad descartada.",
} as const;

/** An editor decides what to do with an opportunity. Accepting or discarding needs a reason. */
export async function decideOpportunity(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireRole(["admin", "editor"]);
  const parsed = decisionSchema.safeParse({
    opportunityId: formData.get("opportunityId"),
    decision: formData.get("decision"),
    reason: formData.get("reason") ?? undefined,
  });
  if (!parsed.success) return actionError("Decisión no válida.");
  const { decision, reason } = parsed.data;
  if (decision !== "shortlisted" && (reason ?? "").length < 3) {
    return actionError("Indica el motivo (al menos 3 caracteres).");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("opportunities")
    .update({
      status: decision,
      decided_by: user.id,
      ...(reason ? { decision_reason: reason } : {}),
    })
    .eq("id", parsed.data.opportunityId);
  if (error) {
    logger.error({ dbErrorCode: error.code }, "opportunity decision failed");
    return actionError("No se pudo guardar la decisión.");
  }
  revalidatePath("/admin/opportunities");
  return actionOk(MESSAGES[decision]);
}
