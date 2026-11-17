import { z } from "zod";

import type { ClaimEvidence } from "./claim-evidence";
import { isFactual, type ClaimCertainty } from "./editorial";
import { findRiskTerms, normalizeTitle } from "./opportunity";

export const SCRIPT_LINE_KINDS = ["hook", "context", "body", "cta"] as const;
export type ScriptLineKind = (typeof SCRIPT_LINE_KINDS)[number];

/** One spoken line of a vertical video. Stored in scripts.lines_json. */
export const scriptLineSchema = z.strictObject({
  kind: z.enum(SCRIPT_LINE_KINDS),
  voice: z.string().trim().min(1).max(400),
  on_screen: z.string().trim().max(120).default(""),
  claim_refs: z.array(z.uuid()).max(5).default([]),
  pause_ms: z.int().min(0).max(3000).default(0),
  visual_note: z.string().trim().max(200).default(""),
});
export type ScriptLine = z.infer<typeof scriptLineSchema>;

/** A script draft, whether written by an editor or proposed by the LLM. */
export const scriptDraftSchema = z.strictObject({
  lines: z.array(scriptLineSchema).min(2).max(20),
  cta: z.string().trim().max(200).default(""),
});
export type ScriptDraft = z.infer<typeof scriptDraftSchema>;

/** What the QA needs to know about each claim of the opportunity. */
export interface ScriptClaim {
  readonly id: string;
  readonly text: string;
  readonly certainty: ClaimCertainty;
  readonly verified: boolean;
  readonly evidence: ClaimEvidence;
}

export const SCRIPT_QA_CODES = [
  "claim_missing",
  "unknown_claim",
  "claim_evidence_insufficient",
  "claim_not_verified",
  "unlabelled_claim",
  "invented_link",
  "unsourced_quote",
  "possible_leak",
  "spoiler",
  "too_long",
  "too_short",
  "missing_hook",
] as const;
export type ScriptQaCode = (typeof SCRIPT_QA_CODES)[number];

export interface ScriptQaIssue {
  readonly severity: "error" | "warning";
  readonly code: ScriptQaCode;
  /** 0-based line index, or null for the whole script. */
  readonly line: number | null;
}

export interface ScriptQaReport {
  readonly version: 1;
  /** No errors. Warnings are shown to the reviewer but do not block. */
  readonly passed: boolean;
  readonly estimatedDurationS: number;
  readonly issues: readonly ScriptQaIssue[];
}

/** Average Spanish narration speed used for the duration estimate. */
export const WORDS_PER_SECOND = 2.6;
/** Hard ceiling for a vertical video in this project. */
export const MAX_DURATION_S = 60;

/** Words a non-factual line must contain so the audience knows it is not a fact (rule 4). */
const LABELS: Readonly<Record<"rumor" | "speculation" | "opinion", readonly string[]>> = {
  rumor: ["rumor", "rumores", "se rumorea", "sin confirmar", "no confirmado", "no esta confirmado"],
  speculation: ["especulacion", "especulamos", "podria", "quiza", "quizas", "teoria", "suponemos"],
  opinion: ["opinion", "en mi opinion", "creo", "creemos", "para mi", "pienso"],
};

function hasLabel(voice: string, certainty: ClaimCertainty): boolean {
  if (isFactual(certainty)) return true;
  const normalized = ` ${normalizeTitle(voice)} `;
  const labels = LABELS[certainty as keyof typeof LABELS];
  return labels.some((label) => normalized.includes(` ${label} `));
}

const URL_PATTERN = /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(com|es|net|org|io|tv|gg)\b/i;
const QUOTE_PATTERN = /[«"“]([^»"”]{3,})[»"”]/g;

function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}

export function estimateDurationS(draft: ScriptDraft): number {
  const words = draft.lines.reduce((sum, line) => sum + wordCount(line.voice), 0);
  const pauses = draft.lines.reduce((sum, line) => sum + line.pause_ms, 0) / 1000;
  return Math.round((words / WORDS_PER_SECOND + pauses) * 10) / 10;
}

/**
 * Quality gate for a script draft. Pure: the web app runs it on every save, and it runs again
 * before approval, so a report written around the app is never trusted.
 *
 * Errors (block review):
 * - context/body lines without a claim reference; references to claims of another opportunity;
 * - claims whose sources do not back them, or factual claims not verified by a second person;
 * - rumor/speculation/opinion claims used without saying so in the line;
 * - links in the spoken or on-screen text (links come only from recorded sources);
 * - quotes that do not appear verbatim in a referenced claim;
 * - leak vocabulary; longer than the target (+10 %) or than 60 s.
 * Warnings: spoilers, much shorter than the target, no hook first.
 */
export function runScriptQa(
  draft: ScriptDraft,
  claims: readonly ScriptClaim[],
  targetDurationS: number,
): ScriptQaReport {
  const byId = new Map(claims.map((claim) => [claim.id, claim]));
  const issues: ScriptQaIssue[] = [];
  const add = (severity: ScriptQaIssue["severity"], code: ScriptQaCode, line: number | null) => {
    if (!issues.some((i) => i.code === code && i.line === line)) {
      issues.push({ severity, code, line });
    }
  };

  draft.lines.forEach((line, index) => {
    if ((line.kind === "context" || line.kind === "body") && line.claim_refs.length === 0) {
      add("error", "claim_missing", index);
    }
    const referenced = line.claim_refs.map((id) => byId.get(id));
    for (const claim of referenced) {
      if (!claim) {
        add("error", "unknown_claim", index);
        continue;
      }
      if (!claim.evidence.ok) add("error", "claim_evidence_insufficient", index);
      if (isFactual(claim.certainty) && !claim.verified) add("error", "claim_not_verified", index);
      if (!hasLabel(line.voice, claim.certainty)) add("error", "unlabelled_claim", index);
    }

    const shown = `${line.voice} ${line.on_screen}`;
    if (URL_PATTERN.test(shown)) add("error", "invented_link", index);

    for (const match of shown.matchAll(QUOTE_PATTERN)) {
      const quoted = normalizeTitle(match[1] ?? "");
      const sourced = referenced.some(
        (claim) => claim !== undefined && normalizeTitle(claim.text).includes(quoted),
      );
      if (!sourced) add("error", "unsourced_quote", index);
    }

    const risk = findRiskTerms(shown);
    if (risk.leak) add("error", "possible_leak", index);
    if (risk.spoiler) add("warning", "spoiler", index);
  });

  if (URL_PATTERN.test(draft.cta)) add("error", "invented_link", null);
  if (draft.lines[0]?.kind !== "hook") add("warning", "missing_hook", 0);

  const estimatedDurationS = estimateDurationS(draft);
  if (estimatedDurationS > Math.min(MAX_DURATION_S, targetDurationS * 1.1)) {
    add("error", "too_long", null);
  } else if (estimatedDurationS < targetDurationS * 0.6) {
    add("warning", "too_short", null);
  }

  return {
    version: 1,
    passed: !issues.some((issue) => issue.severity === "error"),
    estimatedDurationS,
    issues,
  };
}

/** Plain-language explanation of each QA code for the admin panel (Spanish product copy). */
export const SCRIPT_QA_MESSAGES: Readonly<Record<ScriptQaCode, string>> = {
  claim_missing: "Esta línea afirma algo y no cita ninguna afirmación con fuentes.",
  unknown_claim: "Cita una afirmación que no pertenece a esta oportunidad.",
  claim_evidence_insufficient: "Cita una afirmación cuyas fuentes no la respaldan.",
  claim_not_verified: "Cita una afirmación que todavía no ha verificado otra persona.",
  unlabelled_claim:
    "Usa un rumor, especulación u opinión sin decirlo (añade «rumor», «podría», «en mi opinión»…).",
  invented_link: "No pongas enlaces en el guion: los enlaces salen solo de las fuentes.",
  unsourced_quote: "La cita entre comillas no aparece en ninguna afirmación citada.",
  possible_leak: "Menciona una posible filtración: no se puede usar.",
  spoiler: "Puede contener spoilers: avisa al principio o quítalos.",
  too_long: "Dura más que el objetivo (o más de 60 s).",
  too_short: "Es bastante más corto que la duración objetivo.",
  missing_hook: "La primera línea debería ser el gancho.",
};
