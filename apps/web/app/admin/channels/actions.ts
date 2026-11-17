"use server";

import { createChannelInputSchema, pauseInputSchema } from "@gta6/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionError, actionOk, type ActionState } from "@/lib/action-state";
import { requireRole } from "@/lib/auth/require-role";
import { logger } from "@/lib/logger";
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
