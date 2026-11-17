"use server";

import {
  runScriptQa,
  SCRIPT_LINE_KINDS,
  SCRIPT_LOCALES,
  scriptDraftSchema,
  type ScriptDraft,
  type ScriptQaReport,
} from "@gta6/domain";
import type { Json } from "@gta6/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { actionError, actionOk, type ActionState } from "@/lib/action-state";
import { requireRole } from "@/lib/auth/require-role";
import { loadScriptClaims } from "@/lib/claims";
import { EDITOR_ROWS } from "@/lib/scripts";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** An editor starts a new draft for an accepted opportunity and opens it. */
export async function createScript(formData: FormData): Promise<void> {
  const user = await requireRole(["admin", "editor"]);
  const opportunityId = z.uuid().safeParse(formData.get("opportunityId"));
  if (!opportunityId.success) redirect("/admin/opportunities");

  const supabase = await createSupabaseServerClient();
  const { data: opportunity } = await supabase
    .from("opportunities")
    .select("id, status, scripts(version)")
    .eq("id", opportunityId.data)
    .maybeSingle();
  if (opportunity?.status !== "accepted") redirect(`/admin/opportunities/${opportunityId.data}`);

  const version = Math.max(0, ...opportunity.scripts.map((script) => script.version)) + 1;
  const { data: script, error } = await supabase
    .from("scripts")
    .insert({ opportunity_id: opportunity.id, version, created_by: user.id })
    .select("id")
    .single();
  if (error) {
    logger.error({ dbErrorCode: error.code }, "script creation failed");
    redirect(`/admin/opportunities/${opportunity.id}`);
  }
  redirect(`/admin/scripts/${script.id}`);
}

const metaSchema = z.object({
  scriptId: z.uuid(),
  locale: z.enum(SCRIPT_LOCALES),
  targetDurationS: z.coerce.number().int().min(20).max(60),
  cta: z.string().trim().max(200),
});

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** The QA report as stored in scripts.qa_report (plain JSON, with the time it was computed). */
function storedReport(report: ScriptQaReport): NonNullable<Json> {
  return {
    ...report,
    issues: report.issues.map((issue) => ({ ...issue })),
    checkedAt: new Date().toISOString(),
  };
}

function readDraft(
  formData: FormData,
  cta: string,
): ReturnType<typeof scriptDraftSchema.safeParse> {
  const lines: Record<string, unknown>[] = [];
  for (let index = 0; index < EDITOR_ROWS; index += 1) {
    const voice = text(formData, `voice_${String(index)}`).trim();
    if (voice.length === 0) continue;
    const kind = text(formData, `kind_${String(index)}`);
    lines.push({
      kind: (SCRIPT_LINE_KINDS as readonly string[]).includes(kind) ? kind : "body",
      voice,
      on_screen: text(formData, `onScreen_${String(index)}`),
      claim_refs: formData
        .getAll(`claims_${String(index)}`)
        .filter((value): value is string => typeof value === "string"),
      pause_ms: Number(text(formData, `pause_${String(index)}`) || 0),
    });
  }
  return scriptDraftSchema.safeParse({ lines, cta });
}

/** Saves a draft and stores its QA report (recomputed on the server, never sent by the form). */
export async function saveScript(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["admin", "editor"]);
  const meta = metaSchema.safeParse({
    scriptId: formData.get("scriptId"),
    locale: formData.get("locale"),
    targetDurationS: formData.get("targetDurationS"),
    cta: formData.get("cta") ?? "",
  });
  if (!meta.success)
    return actionError("Revisa el idioma, la duración (20 a 60 s) y la llamada a la acción.");
  const draft = readDraft(formData, meta.data.cta);
  if (!draft.success) {
    return actionError("El guion necesita al menos 2 líneas de hasta 400 caracteres.");
  }

  const supabase = await createSupabaseServerClient();
  const { data: script } = await supabase
    .from("scripts")
    .select("id, opportunity_id")
    .eq("id", meta.data.scriptId)
    .maybeSingle();
  if (!script) return actionError("El guion no existe.");

  const claims = await loadScriptClaims(supabase, script.opportunity_id);
  const report = runScriptQa(draft.data, claims, meta.data.targetDurationS);
  const { data: updated, error } = await supabase
    .from("scripts")
    .update({
      lines_json: draft.data.lines,
      cta: draft.data.cta,
      locale: meta.data.locale,
      target_duration_s: meta.data.targetDurationS,
      qa_report: storedReport(report),
    })
    .eq("id", script.id)
    .select("id");
  if (error || updated.length === 0) {
    if (error) logger.error({ dbErrorCode: error.code }, "script save failed");
    return actionError(
      "No se pudo guardar: solo se editan guiones en borrador o con cambios pedidos.",
    );
  }
  revalidatePath(`/admin/scripts/${script.id}`);
  return report.passed
    ? actionOk("Guion guardado. La revisión automática no encuentra errores.")
    : actionError("Guion guardado, pero tiene errores que corregir antes de enviarlo a revisión.");
}

/** Sends a draft to review, only if the QA (run again here) has no errors. */
export async function submitScript(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole(["admin", "editor"]);
  const scriptId = z.uuid().safeParse(formData.get("scriptId"));
  if (!scriptId.success) return actionError("Guion no válido.");

  const supabase = await createSupabaseServerClient();
  const { data: script } = await supabase
    .from("scripts")
    .select("id, opportunity_id, lines_json, cta, target_duration_s")
    .eq("id", scriptId.data)
    .maybeSingle();
  if (!script) return actionError("El guion no existe.");
  const draft = scriptDraftSchema.safeParse({ lines: script.lines_json, cta: script.cta ?? "" });
  if (!draft.success) return actionError("Guarda el guion antes de enviarlo.");

  const report = runScriptQa(
    draft.data satisfies ScriptDraft,
    await loadScriptClaims(supabase, script.opportunity_id),
    script.target_duration_s,
  );
  if (!report.passed)
    return actionError("La revisión automática encuentra errores. Corrígelos y guarda.");

  const { data: updated, error } = await supabase
    .from("scripts")
    .update({ status: "in_review", qa_report: storedReport(report) })
    .eq("id", script.id)
    .select("id");
  if (error || updated.length === 0) {
    if (error) logger.error({ dbErrorCode: error.code }, "script submit failed");
    return actionError("No se pudo enviar a revisión.");
  }
  revalidatePath(`/admin/scripts/${script.id}`);
  return actionOk("Enviado a revisión. Lo aprueba otra persona.");
}
