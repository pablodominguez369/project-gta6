"use server";

import { pauseInputSchema } from "@gta6/domain";
import { revalidatePath } from "next/cache";

import { actionError, actionOk, type ActionState } from "@/lib/action-state";
import { requireRole } from "@/lib/auth/require-role";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Pauses or resumes the whole platform. Runs with the admin's own session, so RLS applies and
 * the audit trigger records the admin as actor.
 */
export async function setGlobalPause(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireRole(["admin"]);
  const parsed = pauseInputSchema.safeParse({
    paused: formData.get("paused") === "true",
    reason: formData.get("reason") ?? undefined,
  });
  if (!parsed.success) {
    return actionError("Indica un motivo de al menos 3 caracteres para pausar.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("system_controls")
    .update({
      global_paused: parsed.data.paused,
      paused_reason: parsed.data.paused ? parsed.data.reason : null,
      updated_by: user.id,
    })
    .eq("id", true)
    .select("global_paused")
    .single();

  if (error) {
    logger.error({ dbErrorCode: error.code }, "global pause update failed");
    return actionError("No se pudo guardar el cambio.");
  }

  logger.info({ globalPaused: data.global_paused, actorId: user.id }, "global pause changed");
  revalidatePath("/admin", "layout");
  return actionOk(data.global_paused ? "Sistema en pausa." : "Sistema reanudado.");
}
