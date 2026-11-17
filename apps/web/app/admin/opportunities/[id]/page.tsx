import { CLAIM_ISSUE_MESSAGES, evaluateClaimEvidence } from "@gta6/domain";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm } from "@/components/action-form";
import { Field, Select } from "@/components/field";
import { requireRole } from "@/lib/auth/require-role";
import {
  CERTAINTY_LABELS,
  CERTAINTY_OPTIONS,
  EVIDENCE_SOURCE_COLUMNS,
  toEvidenceSource,
} from "@/lib/claims";
import { formatDateTime } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { createScript } from "../../scripts/actions";
import { createClaim, verifyClaim } from "./actions";

const SOURCE_COLUMNS = `${EVIDENCE_SOURCE_COLUMNS}, title, url`;

export default async function OpportunityPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireRole("member");
  const canEdit = user.roles.includes("admin") || user.roles.includes("editor");
  const supabase = await createSupabaseServerClient();

  const { data: opportunity } = await supabase
    .from("opportunities")
    .select(`id, topic, status, certainty, opportunity_sources(sources(${SOURCE_COLUMNS}))`)
    .eq("id", id)
    .maybeSingle();
  if (!opportunity) notFound();

  const [{ data: claims }, { data: manualSources }] = await Promise.all([
    supabase
      .from("claims")
      .select(
        `id, text, certainty, sensitive, created_by, verified_at, claim_sources(sources(${SOURCE_COLUMNS}))`,
      )
      .eq("opportunity_id", id)
      .order("created_at"),
    supabase
      .from("sources")
      .select(SOURCE_COLUMNS)
      .is("feed_source_id", null)
      .order("observed_at", { ascending: false })
      .limit(20),
  ]);

  const opportunitySources = opportunity.opportunity_sources.map(({ sources }) => sources);
  const linkedIds = new Set(opportunitySources.map((source) => source.id));
  const selectableSources = [
    ...opportunitySources,
    ...(manualSources ?? []).filter((source) => !linkedIds.has(source.id)),
  ];

  return (
    <section className="flex flex-col gap-6">
      <div>
        <Link href="/admin/opportunities" className="text-sm underline">
          ← Oportunidades
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{opportunity.topic}</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Cada afirmación necesita fuentes, fecha y nivel de certeza. Los rumores se etiquetan
          siempre. Otra persona distinta de quien la escribe la verifica.
        </p>
        {canEdit && opportunity.status === "accepted" ? (
          <form action={createScript} className="mt-3">
            <input type="hidden" name="opportunityId" value={opportunity.id} />
            <button
              type="submit"
              className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
            >
              Nuevo guion
            </button>
          </form>
        ) : null}
      </div>

      <div>
        <h2 className="font-medium">Afirmaciones</h2>
        {(claims ?? []).length === 0 ? (
          <p className="mt-2 text-sm">Todavía no hay afirmaciones.</p>
        ) : null}
        <ul className="mt-2 flex flex-col gap-3">
          {(claims ?? []).map((claim) => {
            const sources = claim.claim_sources.map(({ sources: source }) => source);
            const evidence = evaluateClaimEvidence({
              certainty: claim.certainty,
              sensitive: claim.sensitive,
              sources: sources.map(toEvidenceSource),
            });
            return (
              <li
                key={claim.id}
                className="rounded border border-neutral-200 p-3 dark:border-neutral-800"
                data-testid={`claim-${claim.id}`}
              >
                <p>{claim.text}</p>
                <p className="mt-1 text-sm">
                  {CERTAINTY_LABELS[claim.certainty] ?? claim.certainty}
                  {claim.sensitive ? " · Sensible" : ""}
                  {evidence.mustBeLabelled ? " · Se etiqueta en pantalla" : ""}
                  {" · "}
                  {claim.verified_at
                    ? `Verificada ${formatDateTime(claim.verified_at)}`
                    : "Sin verificar"}
                </p>
                {evidence.issues.length > 0 ? (
                  <ul role="alert" className="mt-1 list-disc pl-5 text-sm text-red-600">
                    {evidence.issues.map((issue) => (
                      <li key={issue}>{CLAIM_ISSUE_MESSAGES[issue]}</li>
                    ))}
                  </ul>
                ) : null}
                <ul className="mt-2 list-disc pl-5 text-sm">
                  {sources.map((source) => (
                    <li key={source.id}>
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="underline"
                      >
                        {source.title}
                      </a>{" "}
                      <span className="text-neutral-500">
                        ({source.publisher},{" "}
                        {formatDateTime(source.published_at ?? source.observed_at)})
                      </span>
                    </li>
                  ))}
                </ul>
                {canEdit && !claim.verified_at && claim.created_by !== user.id && evidence.ok ? (
                  <div className="mt-2">
                    <ActionForm action={verifyClaim} submitLabel="Verificar">
                      <input type="hidden" name="claimId" value={claim.id} />
                    </ActionForm>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>

      {canEdit ? (
        <div className="rounded border border-neutral-200 p-4 dark:border-neutral-800">
          <h2 className="font-medium">Nueva afirmación</h2>
          <ActionForm action={createClaim} submitLabel="Guardar afirmación" testId="new-claim">
            <input type="hidden" name="opportunityId" value={opportunity.id} />
            <Field label="Texto">
              <textarea
                name="text"
                required
                minLength={3}
                maxLength={1000}
                rows={3}
                className="rounded border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              />
            </Field>
            <Field label="Certeza">
              <Select name="certainty" options={CERTAINTY_OPTIONS} defaultValue="rumor" />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="sensitive" />
              Sensible (fechas, precios, personas, salud…): exige fuente oficial o dos medios
            </label>
            <fieldset className="flex flex-col gap-1 text-sm">
              <legend className="mb-1">Fuentes</legend>
              {selectableSources.length === 0 ? (
                <p className="text-neutral-500">No hay fuentes. Añádelas en «Fuentes».</p>
              ) : null}
              {selectableSources.map((source) => (
                <label key={source.id} className="flex items-center gap-2">
                  <input type="checkbox" name="sourceIds" value={source.id} />
                  {source.title} ({source.publisher}, confianza {source.trust_level})
                </label>
              ))}
            </fieldset>
          </ActionForm>
        </div>
      ) : null}
    </section>
  );
}
