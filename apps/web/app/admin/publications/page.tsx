import { randomUUID } from "node:crypto";

import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { Field, Select, TextInput } from "@/components/field";
import { requireRole } from "@/lib/auth/require-role";
import { formatDateTime } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { enqueueSimulatedPublication } from "./actions";

const STATUS_LABELS: Record<string, string> = {
  queued: "En cola",
  in_progress: "En curso",
  succeeded: "Publicada",
  failed: "Fallida",
  ambiguous: "Ambigua: requiere reconciliación",
  blocked: "Bloqueada",
  awaiting_manual: "Lista para subir a mano",
};

const PLATFORM_LABELS: Record<string, string> = {
  simulated: "Simulado",
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
};

/** Why a publication stopped, in plain words. */
const ERROR_LABELS: Record<string, string> = {
  RIGHTS_BLOCKED:
    "Bloqueada por derechos: algún archivo, licencia o la voz del vídeo ya no es válido, o falta el aviso de voz sintética.",
  SYSTEM_PAUSED: "Pausa global activa.",
  CHANNEL_PAUSED: "El canal está en pausa.",
  RATE_LIMITED: "Límite de frecuencia del canal: se reintentará.",
  FORBIDDEN:
    "Subida real no permitida en este canal (falta activarla o la plataforma no lo admite).",
  CREDENTIAL_EXPIRED: "La cuenta del canal no está conectada o su permiso caducó.",
};

export default async function PublicationsPage() {
  const user = await requireRole("member");
  const canEnqueue = user.roles.includes("admin") || user.roles.includes("publisher");
  const supabase = await createSupabaseServerClient();
  const [{ data: publications }, { data: channels }, { data: renders }] = await Promise.all([
    supabase
      .from("publications")
      .select(
        "id, status, error_code, external_id, permalink, payload_json, published_at, created_at, channels(display_name, platform)",
      )
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("channels")
      .select("id, display_name, platform, mode, live_uploads_enabled")
      .order("created_at", { ascending: true }),
    supabase
      .from("renders")
      .select("id, version, created_at, media_projects(scripts(opportunities(topic)))")
      .eq("qc_passed", true)
      .eq("profile", "master")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  // Channels that can take a publication now: the simulator, manual channels, or real channels
  // an admin switched on for private uploads. The worker re-checks everything.
  const usableChannels = (channels ?? []).filter(
    (channel) =>
      channel.platform === "simulated" || channel.mode === "manual" || channel.live_uploads_enabled,
  );

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Publicaciones</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Nada se publica en público. Los canales simulados no salen a ninguna plataforma; los canales
        en modo manual preparan un paquete para que lo subas tú. Antes de cada intento se vuelven a
        comprobar los derechos, la voz y el control técnico del vídeo.
      </p>

      {canEnqueue ? (
        <div className="max-w-md rounded border border-neutral-200 p-4 dark:border-neutral-800">
          <h2 className="mb-3 font-medium">Encolar publicación</h2>
          {usableChannels.length > 0 ? (
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
                  options={usableChannels.map((channel) => ({
                    value: channel.id,
                    label: `${channel.display_name} · ${PLATFORM_LABELS[channel.platform] ?? channel.platform}${channel.mode === "manual" ? " (manual)" : ""}`,
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
              <Field label="Visibilidad">
                <Select
                  name="visibility"
                  placeholder="Elige la visibilidad"
                  options={[{ value: "private", label: "Privado: solo la cuenta lo ve (Solo yo)" }]}
                />
              </Field>
              <Field label="Título">
                <TextInput name="title" required maxLength={100} />
              </Field>
              <Field label="Descripción">
                <TextInput name="description" maxLength={5000} />
              </Field>
              <p className="text-xs text-neutral-500">
                Nada se publica en público. Si el canal es de TikTok: al publicar, aceptas la
                Confirmación de uso de música de TikTok; los comentarios, dúos y stitch quedan
                desactivados, y el vídeo puede tardar unos minutos en procesarse.
              </p>
            </ActionForm>
          ) : (
            <p className="text-sm">
              No hay canales disponibles. Crea uno simulado o en modo manual en Canales.
            </p>
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
                    {publication.status === "awaiting_manual" ? (
                      <Link
                        href={`/admin/publications/${publication.id}`}
                        className="underline"
                        data-testid={`manual-package-${publication.id}`}
                      >
                        {STATUS_LABELS.awaiting_manual}
                      </Link>
                    ) : (
                      (STATUS_LABELS[publication.status] ?? publication.status)
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {publication.error_code
                      ? (ERROR_LABELS[publication.error_code] ?? publication.error_code)
                      : "—"}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">
                    {publication.permalink ? (
                      <a
                        href={publication.permalink}
                        className="underline"
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        {publication.external_id ?? "enlace"}
                      </a>
                    ) : (
                      (publication.external_id ?? "—")
                    )}
                  </td>
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
