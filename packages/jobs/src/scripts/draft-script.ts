import {
  evaluateClaimEvidence,
  isFactual,
  runScriptQa,
  scriptDraftSchema,
  type ClaimCertainty,
  type ErrorCode,
  type ScriptClaim,
  type ScriptLocale,
  type SourceType,
} from "@gta6/domain";
import type pg from "pg";

import { generateWithSpendGate, type SpendGateDeps } from "../llm/generate-with-spend-gate";
import { buildScriptPrompt, SCRIPT_PROMPT_ID, SCRIPT_PROMPT_VERSION } from "./script-prompt";

export interface DraftScriptDeps extends SpendGateDeps {
  readonly pool: pg.Pool;
}

export type DraftOutcome =
  | { readonly kind: "succeeded"; readonly scriptId: string; readonly qaPassed: boolean }
  | { readonly kind: "skipped" }
  | { readonly kind: "blocked"; readonly code: ErrorCode }
  | { readonly kind: "failed"; readonly code: ErrorCode };

/** How long a blocked request waits before the dispatcher tries again. */
export const RECHECK_MS: Partial<Record<ErrorCode, number>> = {
  SPEND_LIMIT_REACHED: 60 * 60_000,
  RATE_LIMITED: 15 * 60_000,
  EXTERNAL_UNAVAILABLE: 15 * 60_000,
  // The call may have gone through; its worst-case cost is already recorded by the gate.
  AMBIGUOUS_EXTERNAL_STATE: 15 * 60_000,
};

/** A running request untouched for this long is assumed orphaned (worker crash). */
export const STALE_RUNNING_MINUTES = 15;

interface RequestRow {
  opportunity_id: string;
  locale: ScriptLocale;
  target_duration_s: number;
  requested_by: string | null;
}

interface ClaimRow {
  id: string;
  text: string;
  certainty: ClaimCertainty;
  sensitive: boolean;
  verified: boolean;
  sources: { publisher: string; source_type: SourceType; trust_level: number; date: string }[];
}

/**
 * Drafts a script for one request. Safe to run more than once for the same id: the request is
 * claimed atomically, and the LLM is only reached through the spend gate. The draft is saved even
 * when its QA fails, so an editor can fix it; it can only go to review once the QA passes.
 */
export async function draftScript(deps: DraftScriptDeps, requestId: string): Promise<DraftOutcome> {
  const { pool, logger } = deps;
  const claimed = await pool.query<RequestRow>(
    `update public.script_requests
        set status = 'running', error_code = null, next_attempt_at = null
      where id = $1
        and (status = 'queued'
             or (status = 'blocked' and coalesce(next_attempt_at, updated_at) <= now())
             or (status = 'running' and updated_at < now() - make_interval(mins => $2)))
      returning opportunity_id, locale, target_duration_s, requested_by`,
    [requestId, STALE_RUNNING_MINUTES],
  );
  const request = claimed.rows[0];
  if (!request) return { kind: "skipped" };

  const fail = async (code: ErrorCode): Promise<DraftOutcome> => {
    await pool.query(
      "update public.script_requests set status = 'failed', error_code = $2 where id = $1",
      [requestId, code],
    );
    return { kind: "failed", code };
  };

  if (deps.provider.name === "disabled") return fail("FORBIDDEN");

  const { rows: opportunities } = await pool.query<{ topic: string; status: string }>(
    "select topic, status from public.opportunities where id = $1",
    [request.opportunity_id],
  );
  const opportunity = opportunities[0];
  if (opportunity?.status !== "accepted") return fail("VALIDATION_FAILED");

  const claims = await loadClaims(pool, request.opportunity_id);
  const usable = claims.filter(
    (claim) => claim.evidence.ok && (claim.verified || !isFactual(claim.certainty)),
  );
  if (usable.length === 0) {
    logger.info("no usable claims: nothing to write a script from");
    return fail("VALIDATION_FAILED");
  }

  const prompt = buildScriptPrompt({
    topic: opportunity.topic,
    locale: request.locale,
    targetDurationS: request.target_duration_s,
    claims: usable.map((claim) => ({ ...claim, sourceDate: claim.evidence.latestSourceDate })),
  });
  const generated = await generateWithSpendGate(deps, prompt);
  if (!generated.ok) {
    const code = generated.error.code;
    const recheck = RECHECK_MS[code];
    if (recheck === undefined) return fail(code);
    await pool.query(
      `update public.script_requests
          set status = 'blocked', error_code = $2, next_attempt_at = now() + make_interval(secs => $3)
        where id = $1`,
      [requestId, code, recheck / 1000],
    );
    return { kind: "blocked", code };
  }

  const draft = scriptDraftSchema.safeParse(generated.value.response.output);
  if (!draft.success) {
    logger.warn({ issues: draft.error.issues.length }, "LLM output is not a valid script");
    return fail("VALIDATION_FAILED");
  }
  const report = runScriptQa(draft.data, claims, request.target_duration_s);

  const scriptId = await insertScript(pool, {
    opportunityId: request.opportunity_id,
    locale: request.locale,
    targetDurationS: request.target_duration_s,
    lines: draft.data.lines,
    cta: draft.data.cta,
    qaReport: { ...report, checkedAt: new Date().toISOString() },
    usageId: generated.value.usageId,
    createdBy: request.requested_by,
  });
  await pool.query(
    "update public.script_requests set status = 'succeeded', script_id = $2 where id = $1",
    [requestId, scriptId],
  );
  logger.info({ scriptId, qaPassed: report.passed }, "script drafted");
  return { kind: "succeeded", scriptId, qaPassed: report.passed };
}

async function loadClaims(pool: pg.Pool, opportunityId: string): Promise<ScriptClaim[]> {
  const { rows } = await pool.query<ClaimRow>(
    `select c.id, c.text, c.certainty, c.sensitive, c.verified_at is not null as verified,
            coalesce(json_agg(json_build_object(
              'publisher', s.publisher, 'source_type', s.source_type, 'trust_level', s.trust_level,
              'date', coalesce(s.published_at, s.observed_at)))
              filter (where s.id is not null), '[]') as sources
       from public.claims c
       left join public.claim_sources cs on cs.claim_id = c.id
       left join public.sources s on s.id = cs.source_id
      where c.opportunity_id = $1
      group by c.id
      order by c.created_at`,
    [opportunityId],
  );
  return rows.map((row) => ({
    id: row.id,
    text: row.text,
    certainty: row.certainty,
    verified: row.verified,
    evidence: evaluateClaimEvidence({
      certainty: row.certainty,
      sensitive: row.sensitive,
      sources: row.sources.map((source) => ({
        publisher: source.publisher,
        sourceType: source.source_type,
        trustLevel: source.trust_level,
        publishedAt: new Date(source.date),
      })),
    }),
  }));
}

interface NewScript {
  readonly opportunityId: string;
  readonly locale: ScriptLocale;
  readonly targetDurationS: number;
  readonly lines: unknown;
  readonly cta: string;
  readonly qaReport: unknown;
  readonly usageId: string;
  readonly createdBy: string | null;
}

/** Next version for the opportunity; retried once if an editor created one at the same moment. */
async function insertScript(pool: pg.Pool, script: NewScript, retry = true): Promise<string> {
  try {
    const { rows } = await pool.query<{ id: string }>(
      `insert into public.scripts
         (opportunity_id, version, locale, target_duration_s, lines_json, cta, status,
          prompt_version, llm_usage_id, qa_report, created_by)
       select $1, coalesce(max(version), 0) + 1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9
         from public.scripts where opportunity_id = $1
       returning id`,
      [
        script.opportunityId,
        script.locale,
        script.targetDurationS,
        JSON.stringify(script.lines),
        script.cta,
        `${SCRIPT_PROMPT_ID}@${SCRIPT_PROMPT_VERSION}`,
        script.usageId,
        JSON.stringify(script.qaReport),
        script.createdBy,
      ],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error("script insert returned no id");
    return id;
  } catch (error) {
    if (retry && (error as { code?: string }).code === "23505") {
      return insertScript(pool, script, false);
    }
    throw error;
  }
}
