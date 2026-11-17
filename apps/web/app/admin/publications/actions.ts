"use server";

import { publicationPayloadSchema } from "@gta6/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionError, actionOk, type ActionState } from "@/lib/action-state";
import { requireRole } from "@/lib/auth/require-role";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const enqueueInputSchema = z.object({
  channelId: z.uuid(),
  // Generated when the form is rendered, so a resubmitted form reuses it and cannot duplicate.
  idempotencyKey: z.string().regex(/^pub_[0-9a-f-]{36}$/),
});

/** Placeholder media for simulated publications. Phase 1 has no render pipeline yet. */
const SIMULATED_MEDIA_REF = "simulated://media/placeholder";

/**
 * Inserts a queued publication with the user's session (RLS: admin or publisher only). The worker
 * dispatcher picks it up; the web app never talks to the job queue or to any platform.
 */
export async function enqueueSimulatedPublication(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireRole(["admin", "publisher"]);
  const input = enqueueInputSchema.safeParse({
    channelId: formData.get("channelId"),
    idempotencyKey: formData.get("idempotencyKey"),
  });
  const payload = publicationPayloadSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") ?? "",
    mediaRef: SIMULATED_MEDIA_REF,
  });
  if (!input.success || !payload.success) {
    return actionError("Revisa el canal y el título (1 a 100 caracteres).");
  }

  const supabase = await createSupabaseServerClient();
  const { data: channel } = await supabase
    .from("channels")
    .select("platform")
    .eq("id", input.data.channelId)
    .maybeSingle();
  if (channel?.platform !== "simulated") {
    return actionError("Solo se puede encolar en canales simulados durante la Fase 1.");
  }

  const { error } = await supabase.from("publications").insert({
    channel_id: input.data.channelId,
    idempotency_key: input.data.idempotencyKey,
    payload_json: payload.data,
    created_by: user.id,
  });
  if (error?.code === "23505") {
    return actionOk("Esta publicación ya estaba encolada.");
  }
  if (error) {
    logger.error({ dbErrorCode: error.code }, "publication enqueue failed");
    return actionError("No se pudo encolar la publicación.");
  }

  revalidatePath("/admin/publications");
  return actionOk("Publicación simulada encolada.");
}
