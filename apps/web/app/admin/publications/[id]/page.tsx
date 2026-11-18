import { manualUploadSteps, publicationPayloadSchema } from "@gta6/domain";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { ActionForm } from "@/components/action-form";
import { Field, TextInput } from "@/components/field";
import { requireRole } from "@/lib/auth/require-role";
import { formatDateTime } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { completeManualPublication } from "../actions";

const PLATFORM_LABELS: Record<string, string> = {
  simulated: "Simulado",
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
};

/**
 * Manual package (T30): everything a person needs to upload the video by hand, and the form to
 * record the link afterwards. The worker already re-checked rights, voice, QC and pauses.
 */
export default async function PublicationPackagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireRole("member");
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const canComplete = user.roles.includes("admin") || user.roles.includes("publisher");

  const supabase = await createSupabaseServerClient();
  const { data: publication } = await supabase
    .from("publications")
    .select(
      "id, status, payload_json, render_id, permalink, published_at, updated_at, channels(display_name, platform)",
    )
    .eq("id", id.data)
    .maybeSingle();
  if (!publication) notFound();

  const payload = publicationPayloadSchema.safeParse(publication.payload_json);
  const platform = publication.channels.platform;
  const steps = manualUploadSteps(platform, payload.success && payload.data.syntheticMedia);
  const waiting = publication.status === "awaiting_manual";

  return (
    <section className="flex max-w-2xl flex-col gap-6">
      <div>
        <Link href="/admin/publications" className="text-sm underline">
          ← Publicaciones
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Paquete para subir a mano</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {publication.channels.display_name} · {PLATFORM_LABELS[platform] ?? platform}
        </p>
      </div>

      {!waiting ? (
        <p className="rounded border border-neutral-200 p-3 text-sm dark:border-neutral-800">
          {publication.status === "succeeded"
            ? `Ya registrada el ${formatDateTime(publication.published_at)}.`
            : "Esta publicación no está esperando una subida manual."}
        </p>
      ) : null}

      {payload.success ? (
        <dl className="flex flex-col gap-3 text-sm">
          <div>
            <dt className="font-medium">Vídeo</dt>
            <dd>
              {publication.render_id ? (
                <a
                  href={`/admin/media/renders/${publication.render_id}/file`}
                  className="underline"
                  data-testid="package-download"
                >
                  Descargar MP4
                </a>
              ) : (
                "Sin vídeo"
              )}
            </dd>
          </div>
          <div>
            <dt className="font-medium">Título</dt>
            <dd className="select-all" data-testid="package-title">
              {payload.data.title}
            </dd>
          </div>
          <div>
            <dt className="font-medium">Descripción</dt>
            <dd className="whitespace-pre-wrap select-all">{payload.data.description || "—"}</dd>
          </div>
        </dl>
      ) : (
        <p className="text-sm">El contenido de esta publicación no es válido.</p>
      )}

      <div className="rounded border border-neutral-200 p-4 text-sm dark:border-neutral-800">
        <h2 className="mb-2 font-medium">Al subirlo</h2>
        <ul className="list-disc pl-5">
          {steps.disclosure ? <li data-testid="package-disclosure">{steps.disclosure}</li> : null}
          <li>{steps.visibility}</li>
          {steps.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </div>

      {waiting && canComplete ? (
        <div className="rounded border border-neutral-200 p-4 dark:border-neutral-800">
          <h2 className="mb-3 font-medium">Ya lo he subido</h2>
          <ActionForm
            action={completeManualPublication}
            submitLabel="Marcar como publicada"
            pendingLabel="Guardando…"
            testId="complete-manual"
          >
            <input type="hidden" name="publicationId" value={publication.id} />
            <Field label="Enlace de la publicación">
              <TextInput
                name="permalink"
                type="url"
                required
                maxLength={500}
                placeholder="https://"
              />
            </Field>
          </ActionForm>
        </div>
      ) : null}
    </section>
  );
}
