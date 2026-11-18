"use server";

import { PLATFORMS } from "@gta6/domain";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { actionError, actionOk, type ActionState } from "@/lib/action-state";
import { requireRole } from "@/lib/auth/require-role";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const EDIT_ROLES = ["admin", "editor"] as const;
const MAX_SCENES = 20;

/** Creates a video project from an approved script and opens it. */
export async function createMediaProject(formData: FormData): Promise<void> {
  const user = await requireRole([...EDIT_ROLES]);
  const scriptId = z.uuid().safeParse(formData.get("scriptId"));
  if (!scriptId.success) redirect("/admin/scripts");
  const supabase = await createSupabaseServerClient();
  const { data: project, error } = await supabase
    .from("media_projects")
    .insert({ script_id: scriptId.data, created_by: user.id })
    .select("id")
    .single();
  if (error) {
    logger.error({ dbErrorCode: error.code }, "media project creation failed");
    redirect(`/admin/scripts/${scriptId.data}`);
  }
  redirect(`/admin/media/${project.id}`);
}

const optionalId = z
  .string()
  .transform((value) => (value === "" ? null : value))
  .pipe(z.uuid().nullable());

const saveSchema = z.object({
  projectId: z.uuid(),
  voiceId: optionalId,
  musicAssetId: optionalId,
  brand: z.string().trim().max(60),
  platforms: z.array(z.enum(PLATFORMS)).min(1).max(4),
  backgrounds: z.array(optionalId).max(MAX_SCENES),
});

function text(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

/** Saves voice, music, brand, platforms and the background of each scene. */
export async function saveMediaProject(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([...EDIT_ROLES]);
  const parsed = saveSchema.safeParse({
    projectId: formData.get("projectId"),
    voiceId: text(formData.get("voiceId")),
    musicAssetId: text(formData.get("musicAssetId")),
    brand: text(formData.get("brand")),
    platforms: formData.getAll("platforms").map(text),
    backgrounds: Array.from({ length: Number(formData.get("sceneCount")) || 0 }, (_, i) =>
      text(formData.get(`background_${String(i)}`)),
    ),
  });
  if (!parsed.success) return actionError("Revisa el proyecto: elige al menos una plataforma.");
  const input = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("media_projects")
    .update({
      voice_id: input.voiceId,
      music_asset_id: input.musicAssetId,
      brand: input.brand,
      target_platforms: [...input.platforms],
    })
    .eq("id", input.projectId);
  if (error?.code === "23514") return actionError("El vídeo se está renderizando; espera.");
  if (error) {
    logger.error({ dbErrorCode: error.code }, "media project save failed");
    return actionError("No se pudo guardar el proyecto.");
  }

  const { error: clearError } = await supabase
    .from("media_project_scenes")
    .delete()
    .eq("project_id", input.projectId);
  const scenes = input.backgrounds.flatMap((assetId, sceneIndex) =>
    assetId ? [{ project_id: input.projectId, scene_index: sceneIndex, asset_id: assetId }] : [],
  );
  const { error: scenesError } =
    clearError || scenes.length === 0
      ? { error: clearError }
      : await supabase.from("media_project_scenes").insert(scenes);
  if (scenesError) {
    logger.error({ dbErrorCode: scenesError.code }, "media project scenes save failed");
    return actionError("No se pudieron guardar los fondos de las escenas.");
  }
  revalidatePath(`/admin/media/${input.projectId}`);
  return actionOk("Proyecto guardado.");
}

/** Queues the render. The worker checks rights, voice and spend again before doing anything. */
export async function queueRender(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([...EDIT_ROLES]);
  const projectId = z.uuid().safeParse(formData.get("projectId"));
  if (!projectId.success) return actionError("Proyecto no válido.");
  const supabase = await createSupabaseServerClient();
  const { data: project } = await supabase
    .from("media_projects")
    .select("voice_id")
    .eq("id", projectId.data)
    .maybeSingle();
  if (!project) return actionError("El proyecto no existe.");
  if (!project.voice_id) return actionError("Elige una voz antes de renderizar.");
  const { error } = await supabase
    .from("media_projects")
    .update({ status: "queued" })
    .eq("id", projectId.data);
  if (error?.code === "23514") return actionError("El vídeo ya se está renderizando.");
  if (error) {
    logger.error({ dbErrorCode: error.code }, "render queue failed");
    return actionError("No se pudo poner en cola.");
  }
  revalidatePath(`/admin/media/${projectId.data}`);
  revalidatePath("/admin/media");
  return actionOk("En cola. El vídeo aparecerá aquí cuando esté listo.");
}
