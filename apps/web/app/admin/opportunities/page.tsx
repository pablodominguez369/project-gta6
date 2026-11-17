import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { TextInput } from "@/components/field";
import { requireRole } from "@/lib/auth/require-role";
import { formatDateTime } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { decideOpportunity } from "./actions";

const CERTAINTY_LABELS: Record<string, string> = {
  confirmed: "Confirmada (fuente oficial)",
  reported: "Reportada (2+ medios fiables)",
  rumor: "Rumor",
  speculation: "Especulación",
  opinion: "Opinión",
};

const FLAG_LABELS: Record<string, string> = {
  leak: "posible filtración",
  spoiler: "spoiler",
  single_source: "una sola fuente",
  unknown_provenance: "procedencia desconocida",
};

const STATUS_LABELS: Record<string, string> = {
  new: "Nueva",
  shortlisted: "Preseleccionada",
  accepted: "Aceptada",
  discarded: "Descartada",
  expired: "Caducada",
};

export default async function OpportunitiesPage() {
  const user = await requireRole("member");
  const canDecide = user.roles.includes("admin") || user.roles.includes("editor");
  const supabase = await createSupabaseServerClient();
  const { data: opportunities } = await supabase
    .from("opportunities")
    .select(
      "id, topic, status, score, certainty, risk_flags, expires_at, decision_reason, opportunity_sources(sources(id, title, publisher, url))",
    )
    .order("score", { ascending: false })
    .limit(50);

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Oportunidades</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        La puntuación ordena qué mirar primero; la certeza dice qué se puede afirmar. Una tendencia
        no es una prueba.
      </p>
      {(opportunities ?? []).length === 0 ? (
        <p className="text-sm">Todavía no hay oportunidades.</p>
      ) : null}
      <ul className="flex flex-col gap-4">
        {(opportunities ?? []).map((opportunity) => (
          <li
            key={opportunity.id}
            className="rounded border border-neutral-200 p-4 dark:border-neutral-800"
            data-testid={`opportunity-${opportunity.id}`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-medium">
                <Link href={`/admin/opportunities/${opportunity.id}`} className="hover:underline">
                  {opportunity.topic}
                </Link>
              </h2>
              <span className="text-sm">
                {STATUS_LABELS[opportunity.status] ?? opportunity.status} · {opportunity.score}/100
              </span>
            </div>
            <p className="mt-1 text-sm">
              {CERTAINTY_LABELS[opportunity.certainty] ?? opportunity.certainty}
              {opportunity.risk_flags.length > 0
                ? ` · Alertas: ${opportunity.risk_flags.map((f) => FLAG_LABELS[f] ?? f).join(", ")}`
                : ""}
            </p>
            <p className="text-xs text-neutral-500">
              Caduca {formatDateTime(opportunity.expires_at)}
              {opportunity.decision_reason ? ` · Motivo: ${opportunity.decision_reason}` : ""}
            </p>
            <ul className="mt-2 list-disc pl-5 text-sm">
              {opportunity.opportunity_sources.map(({ sources: source }) => (
                <li key={source.id}>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="underline"
                  >
                    {source.title}
                  </a>{" "}
                  <span className="text-neutral-500">({source.publisher})</span>
                </li>
              ))}
            </ul>
            {canDecide && (opportunity.status === "new" || opportunity.status === "shortlisted") ? (
              <div className="mt-3 flex flex-wrap gap-4">
                <ActionForm action={decideOpportunity} submitLabel="Preseleccionar">
                  <input type="hidden" name="opportunityId" value={opportunity.id} />
                  <input type="hidden" name="decision" value="shortlisted" />
                </ActionForm>
                <ActionForm action={decideOpportunity} submitLabel="Aceptar">
                  <input type="hidden" name="opportunityId" value={opportunity.id} />
                  <input type="hidden" name="decision" value="accepted" />
                  <TextInput
                    name="reason"
                    placeholder="Motivo"
                    aria-label="Motivo para aceptar"
                    required
                    minLength={3}
                  />
                </ActionForm>
                <ActionForm action={decideOpportunity} submitLabel="Descartar" tone="danger">
                  <input type="hidden" name="opportunityId" value={opportunity.id} />
                  <input type="hidden" name="decision" value="discarded" />
                  <TextInput
                    name="reason"
                    placeholder="Motivo"
                    aria-label="Motivo para descartar"
                    required
                    minLength={3}
                  />
                </ActionForm>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
