import {
  CLAIM_ISSUE_MESSAGES,
  SCRIPT_QA_MESSAGES,
  scriptDraftSchema,
  type ScriptLine,
  type ScriptQaIssue,
} from "@gta6/domain";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm } from "@/components/action-form";
import { Field, Select, TextInput } from "@/components/field";
import { requireRole } from "@/lib/auth/require-role";
import { CERTAINTY_LABELS, loadScriptClaims } from "@/lib/claims";
import {
  EDITOR_ROWS,
  LINE_KIND_OPTIONS,
  LOCALE_OPTIONS,
  SCRIPT_STATUS_LABELS,
} from "@/lib/scripts";
import { formatDateTime } from "@/lib/format";
import { MEDIA_STATUS_LABELS } from "@/lib/media";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { createMediaProject } from "../../media/actions";
import { reviewScript, saveScript, submitScript } from "../actions";

const DECISION_LABELS: Readonly<Record<string, string>> = {
  approved: "Aprobado",
  changes_requested: "Cambios pedidos",
  rejected: "Rechazado",
};

const TEXTAREA_CLASS =
  "rounded border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

function issueText(issue: ScriptQaIssue): string {
  const where = issue.line === null ? "Guion" : `Línea ${String(issue.line + 1)}`;
  return `${where}: ${SCRIPT_QA_MESSAGES[issue.code]}`;
}

export default async function ScriptPage({ params }: { readonly params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireRole("member");
  const supabase = await createSupabaseServerClient();
  const { data: script } = await supabase
    .from("scripts")
    .select(
      "id, opportunity_id, version, status, locale, target_duration_s, lines_json, cta, qa_report, created_by, prompt_version, opportunities(topic)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!script) notFound();

  const [claims, { data: approvals }, { data: mediaProjects }] = await Promise.all([
    loadScriptClaims(supabase, script.opportunity_id),
    supabase
      .from("approvals")
      .select("id, decision, reason, created_at, reviewer_id")
      .eq("target_type", "script")
      .eq("target_id", script.id)
      .order("created_at"),
    supabase
      .from("media_projects")
      .select("id, status")
      .eq("script_id", script.id)
      .order("created_at"),
  ]);
  const canCreateVideo = user.roles.includes("admin") || user.roles.includes("editor");
  const canReview =
    (user.roles.includes("admin") || user.roles.includes("editor")) &&
    script.status === "in_review" &&
    script.created_by !== user.id;
  const parsed = scriptDraftSchema.shape.lines.safeParse(script.lines_json);
  const lines: ScriptLine[] = parsed.success ? parsed.data : [];
  const report = script.qa_report as {
    passed?: boolean;
    issues?: ScriptQaIssue[];
    estimatedDurationS?: number;
  };
  const editable =
    (user.roles.includes("admin") || user.roles.includes("editor")) &&
    (script.status === "draft" || script.status === "changes_requested");
  const rows = Array.from({ length: EDITOR_ROWS }, (_, index) => lines[index]);

  return (
    <section className="flex flex-col gap-6">
      <div>
        <Link href={`/admin/opportunities/${script.opportunity_id}`} className="text-sm underline">
          ← {script.opportunities.topic}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">
          Guion v{script.version} · {SCRIPT_STATUS_LABELS[script.status] ?? script.status}
        </h1>
        {script.prompt_version ? (
          <p className="text-sm text-neutral-500">
            Borrador redactado con IA ({script.prompt_version}).
          </p>
        ) : null}
      </div>

      <div
        className="rounded border border-neutral-200 p-4 dark:border-neutral-800"
        data-testid="qa-report"
      >
        <h2 className="font-medium">Revisión automática</h2>
        {report.issues === undefined ? (
          <p className="mt-1 text-sm">Guarda el guion para revisarlo.</p>
        ) : (
          <>
            <p className="mt-1 text-sm">
              {report.passed ? "Sin errores." : "Tiene errores."} Duración estimada:{" "}
              {report.estimatedDurationS ?? "?"} s (objetivo {script.target_duration_s} s).
            </p>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {report.issues.map((issue) => (
                <li
                  key={`${issue.code}-${String(issue.line)}`}
                  className={issue.severity === "error" ? "text-red-600" : "text-amber-700"}
                >
                  {issueText(issue)}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div>
        <h2 className="font-medium">Afirmaciones disponibles</h2>
        <ul className="mt-1 list-disc pl-5 text-sm">
          {claims.map((claim) => (
            <li key={claim.id}>
              {claim.text}{" "}
              <span className="text-neutral-500">
                ({CERTAINTY_LABELS[claim.certainty] ?? claim.certainty}
                {claim.verified ? ", verificada" : ", sin verificar"}
                {claim.evidence.issues.length > 0
                  ? `, ${claim.evidence.issues.map((i) => CLAIM_ISSUE_MESSAGES[i]).join(" ")}`
                  : ""}
                )
              </span>
            </li>
          ))}
        </ul>
      </div>

      {editable ? (
        <ActionForm action={saveScript} submitLabel="Guardar guion" testId="script-editor">
          <input type="hidden" name="scriptId" value={script.id} />
          <div className="flex flex-wrap gap-4">
            <Field label="Idioma">
              <Select name="locale" options={LOCALE_OPTIONS} defaultValue={script.locale} />
            </Field>
            <Field label="Duración objetivo (s)">
              <TextInput
                name="targetDurationS"
                type="number"
                min={20}
                max={60}
                defaultValue={script.target_duration_s}
              />
            </Field>
          </div>
          {rows.map((line, index) => (
            <fieldset
              key={index}
              className="flex flex-col gap-2 rounded border border-neutral-200 p-3 dark:border-neutral-800"
            >
              <legend className="text-sm">Línea {index + 1}</legend>
              <Field label={`Tipo de la línea ${String(index + 1)}`}>
                <Select
                  name={`kind_${String(index)}`}
                  options={LINE_KIND_OPTIONS}
                  defaultValue={line?.kind ?? (index === 0 ? "hook" : "body")}
                />
              </Field>
              <Field label={`Texto de la línea ${String(index + 1)}`}>
                <textarea
                  name={`voice_${String(index)}`}
                  defaultValue={line?.voice ?? ""}
                  maxLength={400}
                  rows={2}
                  className={TEXTAREA_CLASS}
                />
              </Field>
              <Field label={`Texto en pantalla ${String(index + 1)}`}>
                <TextInput
                  name={`onScreen_${String(index)}`}
                  defaultValue={line?.on_screen ?? ""}
                  maxLength={120}
                />
              </Field>
              <input type="hidden" name={`pause_${String(index)}`} value={line?.pause_ms ?? 0} />
              {claims.length > 0 ? (
                <div className="flex flex-col gap-1 text-sm">
                  <span>Afirmaciones que usa</span>
                  {claims.map((claim) => (
                    <label key={claim.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        name={`claims_${String(index)}`}
                        value={claim.id}
                        defaultChecked={line?.claim_refs.includes(claim.id) ?? false}
                        aria-label={`Línea ${String(index + 1)}: ${claim.text}`}
                      />
                      {claim.text}
                    </label>
                  ))}
                </div>
              ) : null}
            </fieldset>
          ))}
          <Field label="Llamada a la acción">
            <TextInput name="cta" defaultValue={script.cta ?? ""} maxLength={200} />
          </Field>
        </ActionForm>
      ) : (
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
          {lines.map((line, index) => (
            <li key={index}>
              <span className="text-neutral-500">
                [{LINE_KIND_OPTIONS.find((option) => option.value === line.kind)?.label}]
              </span>{" "}
              {line.voice}
            </li>
          ))}
        </ol>
      )}

      {(approvals ?? []).length > 0 ? (
        <div>
          <h2 className="font-medium">Revisiones</h2>
          <ul className="mt-1 list-disc pl-5 text-sm" data-testid="approvals">
            {(approvals ?? []).map((approval) => (
              <li key={approval.id}>
                {DECISION_LABELS[approval.decision] ?? approval.decision} ·{" "}
                {formatDateTime(approval.created_at)}
                {approval.reason ? ` · ${approval.reason}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {canReview ? (
        <div
          className="rounded border border-neutral-200 p-4 dark:border-neutral-800"
          data-testid="review"
        >
          <h2 className="font-medium">Revisar</h2>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Comprueba que cada línea dice lo mismo que sus afirmaciones y que los rumores están
            etiquetados. No puedes revisar tus propios guiones.
          </p>
          <div className="mt-3 flex flex-wrap gap-6">
            <ActionForm action={reviewScript} submitLabel="Aprobar">
              <input type="hidden" name="scriptId" value={script.id} />
              <input type="hidden" name="decision" value="approved" />
            </ActionForm>
            <ActionForm action={reviewScript} submitLabel="Pedir cambios">
              <input type="hidden" name="scriptId" value={script.id} />
              <input type="hidden" name="decision" value="changes_requested" />
              <TextInput
                name="reason"
                aria-label="Motivo de los cambios"
                placeholder="Motivo"
                required
                minLength={3}
              />
            </ActionForm>
            <ActionForm action={reviewScript} submitLabel="Rechazar" tone="danger">
              <input type="hidden" name="scriptId" value={script.id} />
              <input type="hidden" name="decision" value="rejected" />
              <TextInput
                name="reason"
                aria-label="Motivo del rechazo"
                placeholder="Motivo"
                required
                minLength={3}
              />
            </ActionForm>
          </div>
        </div>
      ) : null}

      {editable && report.passed ? (
        <ActionForm action={submitScript} submitLabel="Enviar a revisión">
          <input type="hidden" name="scriptId" value={script.id} />
        </ActionForm>
      ) : null}

      {script.status === "approved" ? (
        <div>
          <h2 className="font-medium">Vídeos</h2>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {(mediaProjects ?? []).map((project) => (
              <li key={project.id}>
                <Link href={`/admin/media/${project.id}`} className="underline">
                  Vídeo · {MEDIA_STATUS_LABELS[project.status] ?? project.status}
                </Link>
              </li>
            ))}
          </ul>
          {canCreateVideo ? (
            <form action={createMediaProject} className="mt-2">
              <input type="hidden" name="scriptId" value={script.id} />
              <button
                type="submit"
                className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
              >
                Crear vídeo
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
