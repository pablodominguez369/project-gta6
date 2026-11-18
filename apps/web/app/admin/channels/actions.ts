"use server";

import { createChannelInputSchema, pauseInputSchema } from "@gta6/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionError, actionOk, type ActionState } from "@/lib/action-state";
import { requireRole } from "@/lib/auth/require-role";
import { logger } from "@/lib/logger";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function createChannel(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireRole(["admin"]);
  const parsed = createChannelInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return actionError("Revisa los campos: nombre, zona horaria IANA y límites.");
  }

  const input = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("channels").insert({
    platform: input.platform,
    display_name: input.displayName,
    mode: input.mode,
    timezone: input.timezone,
    max_posts_per_day: input.maxPostsPerDay,
    min_minutes_between_posts: input.minMinutesBetweenPosts,
    created_by: user.id,
  });
  if (error) {
    logger.error({ dbErrorCode: error.code }, "channel create failed");
    return actionError("No se pudo crear el canal.");
  }

  revalidatePath("/admin/channels");
  return actionOk("Canal creado en modo " + input.mode + ".");
}

const channelIdSchema = z.uuid();

export async function setChannelPause(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole(["admin"]);
  const channelId = channelIdSchema.safeParse(formData.get("channelId"));
  const parsed = pauseInputSchema.safeParse({
    paused: formData.get("paused") === "true",
    reason: formData.get("reason") ?? undefined,
  });
  if (!channelId.success || !parsed.success) {
    return actionError("Indica un motivo de al menos 3 caracteres para pausar.");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("channels")
    .update({
      paused: parsed.data.paused,
      paused_reason: parsed.data.paused ? parsed.data.reason : null,
    })
    .eq("id", channelId.data);
  if (error) {
    logger.error({ dbErrorCode: error.code }, "channel pause update failed");
    return actionError("No se pudo guardar el cambio.");
  }

  revalidatePath("/admin/channels");
  return actionOk(parsed.data.paused ? "Canal en pausa." : "Canal reanudado.");
}

const liveUploadsSchema = z.discriminatedUnion("enabled", [
  z.object({ enabled: z.literal(true), reason: z.string().trim().min(3).max(500) }),
  z.object({ enabled: z.literal(false) }),
]);

/**
 * Admin switch for real PRIVATE uploads on one channel (ADR 0005). Switching on needs a reason
 * and a connected account; the worker also needs PUBLISHING_MODE=live. Audited by trigger.
 */
export async function setLiveUploads(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole(["admin"]);
  const channelId = channelIdSchema.safeParse(formData.get("channelId"));
  const parsed = liveUploadsSchema.safeParse({
    enabled: formData.get("enabled") === "true",
    reason: formData.get("reason") ?? undefined,
  });
  if (!channelId.success || !parsed.success) {
    return actionError("Indica un motivo de al menos 3 caracteres.");
  }

  const supabase = await createSupabaseServerClient();
  if (parsed.data.enabled) {
    const { data: channel } = await supabase
      .from("channels")
      .select("platform")
      .eq("id", channelId.data)
      .maybeSingle();
    if (!channel || channel.platform === "simulated" || channel.platform === "instagram") {
      return actionError("Este canal no admite subidas reales privadas.");
    }
    const { count } = await supabase
      .from("credential_refs")
      .select("id", { count: "exact", head: true })
      .eq("channel_id", channelId.data)
      .eq("status", "active");
    if (!count) return actionError("Primero conecta la cuenta del canal.");
  }

  const { error } = await supabase
    .from("channels")
    .update(
      parsed.data.enabled
        ? { live_uploads_enabled: true, live_uploads_reason: parsed.data.reason }
        : { live_uploads_enabled: false },
    )
    .eq("id", channelId.data);
  if (error) {
    logger.error({ dbErrorCode: error.code }, "live uploads update failed");
    return actionError("No se pudo guardar el cambio.");
  }
  revalidatePath("/admin/channels");
  return actionOk(
    parsed.data.enabled ? "Subidas privadas activadas." : "Subidas reales desactivadas.",
  );
}

/** Disconnects the channel's account: revokes its credentials, deletes the tokens from Vault. */
export async function disconnectChannelAccount(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireRole(["admin"]);
  const channelId = channelIdSchema.safeParse(formData.get("channelId"));
  if (!channelId.success) return actionError("Canal no válido.");
  const { error } = await createSupabaseAdminClient().rpc("revoke_channel_credentials", {
    channel_id: channelId.data,
    actor_id: user.id,
  });
  if (error) {
    logger.error({ dbErrorCode: error.code }, "disconnect failed");
    return actionError("No se pudo desconectar la cuenta.");
  }
  revalidatePath("/admin/channels");
  return actionOk("Cuenta desconectada.");
}
