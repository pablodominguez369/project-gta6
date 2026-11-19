"use server";

import { isPlatformPermalink, publicationPayloadSchema } from "@gta6/domain";
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
  // Empty = text-only simulation (only allowed on the simulator).
  renderId: z.union([z.literal(""), z.uuid()]),
  // Chosen by the person for every post, no default (TikTok UX rules). "public" also needs the
  // channel's public switch (ADR 0007).
  visibility: z.union([z.literal(""), z.literal("private"), z.literal("public")]),
});

/** Placeholder media for simulated publications without a video. */
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
    renderId: formData.get("renderId") ?? "",
    visibility: formData.get("visibility") ?? "",
  });
  if (!input.success) return actionError("Revisa el canal y el vídeo.");

  const supabase = await createSupabaseServerClient();
  let render: { id: string; storage_path: string; disclosure_required: boolean } | null = null;
  if (input.data.renderId) {
    const { data } = await supabase
      .from("renders")
      .select("id, storage_path, disclosure_required")
      .eq("id", input.data.renderId)
      .eq("qc_passed", true)
      .maybeSingle();
    if (!data) return actionError("Ese vídeo no existe o no pasó el control técnico.");
    render = data;
  }
  const payload = publicationPayloadSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") ?? "",
    mediaRef: render?.storage_path ?? SIMULATED_MEDIA_REF,
    // Declared to the platform whenever the video has a synthetic voice (rule 5).
    syntheticMedia: render?.disclosure_required ?? false,
    visibilityConfirmed: input.data.visibility !== "",
    visibility: input.data.visibility === "public" ? "public" : "private",
  });
  if (!payload.success) {
    return actionError("Revisa el canal y el título (1 a 100 caracteres).");
  }

  const { data: channel } = await supabase
    .from("channels")
    .select("platform, mode, live_uploads_enabled, public_uploads_enabled")
    .eq("id", input.data.channelId)
    .maybeSingle();
  if (!channel) return actionError("Ese canal no existe.");
  // Real platforms: by hand (manual mode) or, once an admin switched it on, private uploads.
  const allowed =
    channel.platform === "simulated" || channel.mode === "manual" || channel.live_uploads_enabled;
  if (!allowed) {
    return actionError(
      "Este canal no tiene subida real activada. Ponlo en modo manual para publicarlo a mano.",
    );
  }
  if (channel.platform !== "simulated" && !render) {
    return actionError("Para una plataforma real hay que elegir un vídeo.");
  }
  if (channel.platform !== "simulated" && input.data.visibility === "") {
    return actionError("Elige la visibilidad de la publicación.");
  }
  if (
    input.data.visibility === "public" &&
    (channel.mode === "manual" || !channel.public_uploads_enabled)
  ) {
    return actionError("Este canal no tiene permitida la publicación pública.");
  }

  const { error } = await supabase.from("publications").insert({
    channel_id: input.data.channelId,
    idempotency_key: input.data.idempotencyKey,
    payload_json: payload.data,
    render_id: render?.id ?? null,
    created_by: user.id,
  });
  if (error?.code === "23505") {
    return actionOk("Esta publicación ya estaba encolada.");
  }
  if (error?.code === "23514") {
    return actionError("Ese vídeo no se puede publicar: no pasó el control técnico.");
  }
  if (error) {
    logger.error({ dbErrorCode: error.code }, "publication enqueue failed");
    return actionError("No se pudo encolar la publicación.");
  }

  revalidatePath("/admin/publications");
  return actionOk(
    channel.mode === "manual"
      ? "Encolada. Cuando pase los controles, tendrás el paquete para subirlo a mano."
      : "Publicación encolada.",
  );
}

const manualCompletionSchema = z.object({
  publicationId: z.uuid(),
  permalink: z.string().trim().min(1).max(500),
});

/**
 * Records that a person uploaded the manual package. The database function re-checks the role
 * and that the publication is waiting for a manual upload, then audits it.
 */
export async function completeManualPublication(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole(["admin", "publisher"]);
  const input = manualCompletionSchema.safeParse({
    publicationId: formData.get("publicationId"),
    permalink: formData.get("permalink"),
  });
  if (!input.success) return actionError("Pega el enlace de la publicación.");

  const supabase = await createSupabaseServerClient();
  const { data: publication } = await supabase
    .from("publications")
    .select("status, channels(platform)")
    .eq("id", input.data.publicationId)
    .maybeSingle();
  if (publication?.status !== "awaiting_manual") {
    return actionError("Esta publicación no está esperando una subida manual.");
  }
  if (!isPlatformPermalink(publication.channels.platform, input.data.permalink)) {
    return actionError("El enlace debe ser https y de la propia plataforma.");
  }

  const { error } = await supabase.rpc("complete_manual_publication", {
    publication_id: input.data.publicationId,
    permalink: input.data.permalink,
  });
  if (error) {
    logger.error({ dbErrorCode: error.code }, "manual publication completion failed");
    return actionError("No se pudo registrar la publicación.");
  }
  revalidatePath("/admin/publications");
  revalidatePath(`/admin/publications/${input.data.publicationId}`);
  return actionOk("Publicación registrada.");
}
