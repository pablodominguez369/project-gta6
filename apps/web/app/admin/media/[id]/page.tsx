import {
  buildStoryboard,
  estimateVoiceMs,
  findOverflowingText,
  hasAnyRole,
  scriptDraftSchema,
} from "@gta6/domain";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm } from "@/components/action-form";
import { Field, Select, TextInput } from "@/components/field";
import { requireRole } from "@/lib/auth/require-role";
import { formatDateTime } from "@/lib/format";
import { loadUsableMedia, MEDIA_STATUS_LABELS } from "@/lib/media";
import { PLATFORM_OPTIONS } from "@/lib/rights";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { queueRender, saveMediaProject } from "../actions";

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

export default async function MediaProjectPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireRole("member");
  const canEdit = hasAnyRole(user.roles, ["admin", "editor"]);
  const supabase = await createSupabaseServerClient();
  const { data: project } = await supabase
    .from("media_projects")
    .select(
      "id, script_id, status, status_reason, voice_id, music_asset_id, brand, target_platforms, updated_at, scripts(version, lines_json, cta, opportunities(topic)), media_project_scenes(scene_index, asset_id)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!project) notFound();

  const [media, { data: renders }] = await Promise.all([
    loadUsableMedia(supabase),
    supabase
      .from("renders")
      .select("id, version, profile, duration_ms, size_bytes, qc_passed, created_at")
      .eq("project_id", project.id)
      .order("version", { ascending: false })
      .order("profile"),
  ]);
  const draft = scriptDraftSchema.safeParse({
    lines: project.scripts.lines_json,
    cta: project.scripts.cta ?? "",
  });
  const backgrounds = new Map(
    project.media_project_scenes.map((scene) => [scene.scene_index, scene.asset_id]),
  );
  const storyboard = draft.success
    ? buildStoryboard(
        draft.data,
        draft.data.lines.map((line) => estimateVoiceMs(line.voice)),
        draft.data.lines.map((_, index) => backgrounds.get(index) ?? null),
      )
    : null;
  const overflowing = storyboard ? findOverflowingText(storyboard) : [];
  const editable = canEdit && project.status !== "queued" && project.status !== "rendering";
  const backgroundOptions = [{ value: "", label: "Fondo de marca" }, ...media.backgrounds];

  return (
    <section className="flex flex-col gap-6">
      <div>
        <Link href={`/admin/scripts/${project.script_id}`} className="text-sm underline">
          ← Guion v{project.scripts.version}: {project.scripts.opportunities.topic}
        </Link>
        <h1 className="mt-2 text-xl font-semibold" data-testid="media-status">
          Vídeo · {MEDIA_STATUS_LABELS[project.status] ?? project.status}
        </h1>
        {project.status_reason ? (
          <p className="text-sm text-red-600">{project.status_reason}</p>
        ) : null}
      </div>

      {storyboard ? (
        <div>
          <h2 className="font-medium">Escenas (duración estimada {seconds(storyboard.totalMs)})</h2>
          {overflowing.length > 0 ? (
            <p className="text-sm text-red-600">
              El texto en pantalla de la escena {overflowing.map((i) => i + 1).join(", ")} no cabe
              en el móvil: se cortará a tres líneas. Acórtalo en el guion.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-red-600">El guion no es válido.</p>
      )}

      {storyboard && editable ? (
        <ActionForm action={saveMediaProject} submitLabel="Guardar proyecto" testId="media-form">
          <input type="hidden" name="projectId" value={project.id} />
          <input type="hidden" name="sceneCount" value={storyboard.scenes.length} />
          <ol className="flex flex-col gap-3">
            {storyboard.scenes.map((scene) => (
              <li
                key={scene.index}
                className="rounded border border-neutral-200 p-3 text-sm dark:border-neutral-800"
              >
                <p>
                  <strong>
                    {scene.index + 1}. {seconds(scene.startMs)}–{seconds(scene.endMs)}
                  </strong>{" "}
                  {scene.voice}
                </p>
                {scene.onScreen ? (
                  <p className="text-neutral-500">En pantalla: {scene.onScreen}</p>
                ) : null}
                <Field label={`Fondo de la escena ${String(scene.index + 1)}`}>
                  <Select
                    name={`background_${String(scene.index)}`}
                    options={backgroundOptions}
                    defaultValue={scene.backgroundAssetId ?? ""}
                  />
                </Field>
              </li>
            ))}
          </ol>
          <Field label="Voz">
            <Select
              name="voiceId"
              options={[{ value: "", label: "Elige una voz aprobada" }, ...media.voices]}
              defaultValue={project.voice_id ?? ""}
            />
          </Field>
          <Field label="Música (opcional)">
            <Select
              name="musicAssetId"
              options={[{ value: "", label: "Sin música" }, ...media.music]}
              defaultValue={project.music_asset_id ?? ""}
            />
          </Field>
          <Field label="Marca propia en el vídeo">
            <TextInput name="brand" maxLength={60} defaultValue={project.brand} />
          </Field>
          <fieldset className="flex gap-4 text-sm">
            <legend className="mb-1">Plataformas</legend>
            {PLATFORM_OPTIONS.map((option) => (
              <label key={option.value} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  name="platforms"
                  value={option.value}
                  defaultChecked={project.target_platforms.includes(option.value)}
                />
                {option.label}
              </label>
            ))}
          </fieldset>
        </ActionForm>
      ) : null}

      {editable ? (
        <ActionForm action={queueRender} submitLabel="Renderizar vídeo" testId="queue-render">
          <input type="hidden" name="projectId" value={project.id} />
        </ActionForm>
      ) : null}

      <div>
        <h2 className="font-medium">Renders</h2>
        {(renders ?? []).length === 0 ? (
          <p className="text-sm">Todavía no hay renders.</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1 text-sm" data-testid="renders">
            {(renders ?? []).map((render) => (
              <li key={render.id}>
                v{render.version} · {render.profile} · {seconds(render.duration_ms)} ·{" "}
                {(render.size_bytes / 1_000_000).toFixed(1)} MB ·{" "}
                {render.qc_passed ? "Control técnico superado" : "Control técnico fallido"} ·{" "}
                {formatDateTime(render.created_at)} ·{" "}
                <a href={`/admin/media/renders/${render.id}/file`} className="underline">
                  Descargar
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
