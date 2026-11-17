import { SOURCE_TYPES } from "@gta6/domain";

import { ActionForm } from "@/components/action-form";
import { Field, Select, TextInput } from "@/components/field";
import { requireRole } from "@/lib/auth/require-role";
import { formatDateTime } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { addFeed, addManualSource, disableFeed, enableFeed } from "./actions";

const TYPE_OPTIONS = SOURCE_TYPES.map((value) => ({ value, label: value }));

export default async function SourcesPage() {
  const user = await requireRole("member");
  const isAdmin = user.roles.includes("admin");
  const canAdd = isAdmin || user.roles.includes("editor");
  const supabase = await createSupabaseServerClient();
  const [{ data: sources }, { data: feeds }] = await Promise.all([
    supabase
      .from("sources")
      .select("id, url, title, publisher, source_type, trust_level, published_at, observed_at")
      .order("observed_at", { ascending: false })
      .limit(50),
    supabase
      .from("feed_sources")
      .select(
        "id, url, publisher, kind, source_type, trust_level, enabled, terms_url, terms_checked_at, last_polled_at, consecutive_failures",
      )
      .order("created_at", { ascending: true }),
  ]);

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Fuentes</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Solo fuentes permitidas: feeds revisados por un admin o URLs añadidas a mano. Se guarda el
        título, el enlace y un extracto de 300 caracteres como máximo, nunca el artículo entero.
      </p>

      {canAdd ? (
        <div className="max-w-md rounded border border-neutral-200 p-4 dark:border-neutral-800">
          <h2 className="mb-3 font-medium">Añadir fuente manual</h2>
          <ActionForm action={addManualSource} submitLabel="Añadir fuente" testId="add-source">
            <Field label="URL">
              <TextInput name="url" type="url" required />
            </Field>
            <Field label="Título">
              <TextInput name="title" required maxLength={500} />
            </Field>
            <Field label="Medio">
              <TextInput name="publisher" required maxLength={200} />
            </Field>
            <Field label="Tipo">
              <Select name="sourceType" defaultValue="press" options={TYPE_OPTIONS} />
            </Field>
            <Field label="Fecha de publicación">
              <TextInput name="publishedAt" type="date" />
            </Field>
            <Field label="Extracto (se recorta a 300 caracteres)">
              <TextInput name="excerpt" maxLength={5000} />
            </Field>
          </ActionForm>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm" data-testid="sources-table">
          <thead className="text-neutral-500">
            <tr>
              <th className="py-2 pr-4">Título</th>
              <th className="py-2 pr-4">Medio</th>
              <th className="py-2 pr-4">Tipo</th>
              <th className="py-2 pr-4">Confianza</th>
              <th className="py-2 pr-4">Publicada</th>
              <th className="py-2">Vista</th>
            </tr>
          </thead>
          <tbody>
            {(sources ?? []).map((source) => (
              <tr key={source.id} className="border-t border-neutral-200 dark:border-neutral-800">
                <td className="py-2 pr-4">
                  <a
                    href={source.url}
                    rel="noopener noreferrer nofollow"
                    target="_blank"
                    className="underline"
                  >
                    {source.title}
                  </a>
                </td>
                <td className="py-2 pr-4">{source.publisher}</td>
                <td className="py-2 pr-4">{source.source_type}</td>
                <td className="py-2 pr-4">{source.trust_level}/3</td>
                <td className="py-2 pr-4">{formatDateTime(source.published_at)}</td>
                <td className="py-2">{formatDateTime(source.observed_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="text-lg font-semibold">Feeds permitidos</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-neutral-500">
            <tr>
              <th className="py-2 pr-4">Feed</th>
              <th className="py-2 pr-4">Tipo</th>
              <th className="py-2 pr-4">Estado</th>
              <th className="py-2 pr-4">Último sondeo</th>
              {isAdmin ? <th className="py-2">Acción</th> : null}
            </tr>
          </thead>
          <tbody>
            {(feeds ?? []).map((feed) => (
              <tr
                key={feed.id}
                className="border-t border-neutral-200 align-top dark:border-neutral-800"
                data-testid={`feed-${feed.id}`}
              >
                <td className="py-2 pr-4">
                  {feed.publisher}
                  <div className="font-mono text-xs text-neutral-500">{feed.url}</div>
                </td>
                <td className="py-2 pr-4">
                  {feed.kind} · {feed.source_type} · {feed.trust_level}/3
                </td>
                <td className="py-2 pr-4">
                  {feed.enabled ? "Activo" : "Desactivado"}
                  {feed.consecutive_failures > 0
                    ? ` (${String(feed.consecutive_failures)} fallos)`
                    : ""}
                  {feed.terms_checked_at ? (
                    <div className="text-xs text-neutral-500">
                      Términos revisados {formatDateTime(feed.terms_checked_at)}
                    </div>
                  ) : null}
                </td>
                <td className="py-2 pr-4">{formatDateTime(feed.last_polled_at)}</td>
                {isAdmin ? (
                  <td className="py-2">
                    {feed.enabled ? (
                      <ActionForm action={disableFeed} submitLabel="Desactivar" tone="danger">
                        <input type="hidden" name="feedId" value={feed.id} />
                      </ActionForm>
                    ) : (
                      <ActionForm action={enableFeed} submitLabel="Activar">
                        <input type="hidden" name="feedId" value={feed.id} />
                        <TextInput
                          name="termsUrl"
                          type="url"
                          placeholder="URL de los términos de uso"
                          aria-label="URL de los términos de uso"
                          defaultValue={feed.terms_url ?? ""}
                          required
                        />
                        <label className="flex items-center gap-2 text-xs">
                          <input type="checkbox" name="termsReviewed" required />
                          He revisado que los términos permiten el uso automatizado
                        </label>
                      </ActionForm>
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isAdmin ? (
        <div className="max-w-md rounded border border-neutral-200 p-4 dark:border-neutral-800">
          <h2 className="mb-3 font-medium">Añadir feed</h2>
          <ActionForm action={addFeed} submitLabel="Añadir feed" testId="add-feed">
            <Field label="URL del feed (https)">
              <TextInput name="url" type="url" required />
            </Field>
            <Field label="Medio">
              <TextInput name="publisher" required maxLength={200} />
            </Field>
            <Field label="Formato">
              <Select
                name="kind"
                defaultValue="rss"
                options={[
                  { value: "rss", label: "RSS" },
                  { value: "atom", label: "Atom" },
                ]}
              />
            </Field>
            <Field label="Tipo de fuente">
              <Select name="sourceType" defaultValue="press" options={TYPE_OPTIONS} />
            </Field>
            <Field label="Confianza (0 desconocida, 3 oficial)">
              <TextInput name="trustLevel" type="number" min={0} max={3} defaultValue={1} />
            </Field>
          </ActionForm>
        </div>
      ) : null}
    </section>
  );
}
