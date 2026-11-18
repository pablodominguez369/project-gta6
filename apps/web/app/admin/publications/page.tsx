import { randomUUID } from "node:crypto";

import { ActionForm } from "@/components/action-form";
import { Field, Select, TextInput } from "@/components/field";
import { requireRole } from "@/lib/auth/require-role";
import { formatDateTime } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { enqueueSimulatedPublication } from "./actions";

const STATUS_LABELS: Record<string, string> = {
  queued: "En cola",
  in_progress: "En curso",
  succeeded: "Publicada (simulada)",
  failed: "Fallida",
  ambiguous: "Ambigua: requiere reconciliación",
  blocked: "Bloqueada",
};

/** Why a publication stopped, in plain words. */
const ERROR_LABELS: Record<string, string> = {
  RIGHTS_BLOCKED:
    "Bloqueada por derechos: algún archivo, licencia o la voz del vídeo ya no es válido, o falta el aviso de voz sintética.",
  SYSTEM_PAUSED: "Pausa global activa.",
  CHANNEL_PAUSED: "El canal está en pausa.",
  RATE_LIMITED: "Límite de frecuencia del canal: se reintentará.",
};

export default async function PublicationsPage() {
  const user = await requireRole("member");
  const canEnqueue = user.roles.includes("admin") || user.roles.includes("publisher");
  const supabase = await createSupabaseServerClient();
  const [{ data: publications }, { data: channels }, { data: renders }] = await Promise.all([
    supabase
      .from("publications")
      .select(
        "id, status, error_code, external_id, permalink, payload_json, published_at, created_at, channels(display_name)",
      )
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("channels")
      .select("id, display_name")
      .eq("platform", "simulated")
      .order("created_at", { ascending: true }),
    supabase
      .from("renders")
      .select("id, version, created_at, media_projects(scripts(opportunities(topic)))")
      .eq("qc_passed", true)
      .eq("profile", "master")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Publicaciones</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Solo publicación simulada: nada sale a ninguna plataforma real. Antes de cada intento se
        vuelven a comprobar los derechos, la voz y el control técnico del vídeo.
      </p>

      {canEnqueue ? (
        <div className="max-w-md rounded border border-neutral-200 p-4 dark:border-neutral-800">
          <h2 className="mb-3 font-medium">Encolar publicación simulada</h2>
          {channels && channels.length > 0 ? (
            <ActionForm
              action={enqueueSimulatedPublication}
              submitLabel="Encolar"
              pendingLabel="Encolando…"
              testId="enqueue-publication"
            >
              <input type="hidden" name="idempotencyKey" value={`pub_${randomUUID()}`} />
              <Field label="Canal">
                <Select
                  name="channelId"
                  options={channels.map((channel) => ({
                    value: channel.id,
                    label: channel.display_name,
                  }))}
                />
              </Field>
              <Field label="Vídeo">
                <Select
                  name="renderId"
                  options={[
                    { value: "", label: "Sin vídeo (solo simulación)" },
                    ...(renders ?? []).map((render) => ({
                      value: render.id,
                      label: `${render.media_projects.scripts.opportunities.topic} · v${String(render.version)} · ${formatDateTime(render.created_at)}`,
                    })),
                  ]}
                />
              </Field>
              <Field label="Título">
                <TextInput name="title" required maxLength={100} />
              </Field>
              <Field label="Descripción">
                <TextInput name="description" maxLength={5000} />
              </Field>
            </ActionForm>
          ) : (
            <p className="text-sm">No hay canales simulados. Crea uno en Canales.</p>
          )}
        </div>
      ) : null}

      {publications && publications.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-neutral-500">
              <tr>
                <th className="py-2 pr-4">Título</th>
                <th className="py-2 pr-4">Canal</th>
                <th className="py-2 pr-4">Estado</th>
                <th className="py-2 pr-4">Error</th>
                <th className="py-2 pr-4">ID externo</th>
                <th className="py-2 pr-4">Creada</th>
                <th className="py-2">Publicada</th>
              </tr>
            </thead>
            <tbody>
              {publications.map((publication) => (
                <tr
                  key={publication.id}
                  className="border-t border-neutral-200 align-top dark:border-neutral-800"
                  data-testid={`publication-${publication.id}`}
                >
                  <td className="py-2 pr-4">{titleOf(publication.payload_json)}</td>
                  <td className="py-2 pr-4">{publication.channels.display_name}</td>
                  <td className="py-2 pr-4">
                    {STATUS_LABELS[publication.status] ?? publication.status}
                  </td>
                  <td className="py-2 pr-4">
                    {publication.error_code
                      ? (ERROR_LABELS[publication.error_code] ?? publication.error_code)
                      : "—"}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">{publication.external_id ?? "—"}</td>
                  <td className="py-2 pr-4">{formatDateTime(publication.created_at)}</td>
                  <td className="py-2">{formatDateTime(publication.published_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Todavía no hay publicaciones.
        </p>
      )}
    </section>
  );
}

function titleOf(payload: unknown): string {
  if (typeof payload === "object" && payload !== null && "title" in payload) {
    const title = payload.title;
    if (typeof title === "string") return title;
  }
  return "(sin título)";
}
