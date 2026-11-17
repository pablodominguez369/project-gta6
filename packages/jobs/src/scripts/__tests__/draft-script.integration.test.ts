import { randomUUID } from "node:crypto";

import { DisabledLlmProvider, FakeLlmProvider, type LlmRequest } from "@gta6/connectors";
import { createLogger } from "@gta6/observability";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { testDatabaseUrl } from "../../__tests__/test-db";
import { PgLlmUsageStore } from "../../llm/llm-usage-store";
import { draftScript } from "../draft-script";

const logger = createLogger({ name: "draft-script-it", level: "fatal" });
const pool = new pg.Pool({ connectionString: testDatabaseUrl, max: 4 });
const store = new PgLlmUsageStore(pool);
const run = randomUUID();
const userId = randomUUID();
const checkerId = randomUUID();
let opportunityId = "";
let sourceId = "";
let claimId = "";

/** A valid answer citing the confirmed claim, as the LLM would return it. */
function goodDraft(request: LlmRequest) {
  const material = JSON.parse(request.user.slice(request.user.indexOf("{"))) as {
    afirmaciones: { id: string }[];
  };
  const ref = material.afirmaciones[0]?.id ?? "";
  return {
    lines: [
      {
        kind: "hook",
        voice: "Hay noticias",
        on_screen: "",
        claim_refs: [],
        pause_ms: 0,
        visual_note: "",
      },
      {
        kind: "body",
        voice: "El estudio ha anunciado la fecha",
        on_screen: "",
        claim_refs: [ref],
        pause_ms: 0,
        visual_note: "",
      },
      {
        kind: "cta",
        voice: "Te lo seguiremos contando",
        on_screen: "",
        claim_refs: [],
        pause_ms: 0,
        visual_note: "",
      },
    ],
    cta: "",
  };
}

async function newRequest(): Promise<string> {
  await pool.query(
    "delete from public.script_requests where opportunity_id = $1 and status in ('queued','running','blocked')",
    [opportunityId],
  );
  const { rows } = await pool.query<{ id: string }>(
    "insert into public.script_requests (opportunity_id, requested_by, target_duration_s) values ($1, $2, 20) returning id",
    [opportunityId, userId],
  );
  return rows[0]?.id ?? "";
}

async function requestRow(id: string) {
  const { rows } = await pool.query<{
    status: string;
    error_code: string | null;
    script_id: string | null;
  }>("select status, error_code, script_id from public.script_requests where id = $1", [id]);
  return rows[0];
}

async function setLimits(daily: number, monthly: number): Promise<void> {
  await pool.query(
    "update public.system_controls set daily_spend_limit_eur = $1, monthly_spend_limit_eur = $2",
    [daily, monthly],
  );
}

beforeAll(async () => {
  await pool.query(
    `insert into auth.users (id, email, aud, role) values
       ($1, $3, 'authenticated', 'authenticated'), ($2, $4, 'authenticated', 'authenticated')`,
    [userId, checkerId, `draft-${run}@example.test`, `draft-check-${run}@example.test`],
  );
  const opportunity = await pool.query<{ id: string }>(
    "insert into public.opportunities (topic, status, decision_reason) values ($1, 'accepted', 'it') returning id",
    [`Draft ${run}`],
  );
  opportunityId = opportunity.rows[0]?.id ?? "";
  const url = `https://example.test/draft/${run}`;
  const source = await pool.query<{ id: string }>(
    `insert into public.sources (url, canonical_url, publisher, title, source_type, trust_level, published_at)
     values ($1, $1, 'Estudio', 'Comunicado', 'official', 3, now()) returning id`,
    [url],
  );
  sourceId = source.rows[0]?.id ?? "";
  const client = await pool.connect();
  try {
    await client.query("begin");
    const claim = await client.query<{ id: string }>(
      `insert into public.claims (opportunity_id, text, certainty, created_by)
       values ($1, 'El estudio anunció la fecha', 'confirmed', $2) returning id`,
      [opportunityId, userId],
    );
    claimId = claim.rows[0]?.id ?? "";
    await client.query("insert into public.claim_sources (claim_id, source_id) values ($1, $2)", [
      claimId,
      sourceId,
    ]);
    await client.query("commit");
  } finally {
    client.release();
  }
  await pool.query("update public.claims set verified_at = now(), verified_by = $2 where id = $1", [
    claimId,
    checkerId,
  ]);
});

beforeEach(async () => {
  await setLimits(0, 0);
});

afterAll(async () => {
  await setLimits(0, 0);
  await pool.query("delete from public.scripts where opportunity_id = $1", [opportunityId]);
  await pool.query("delete from public.opportunities where id = $1", [opportunityId]);
  await pool.query("delete from public.sources where id = $1", [sourceId]);
  await pool.query("delete from auth.users where id = any($1)", [[userId, checkerId]]);
  await pool.end();
});

describe("draftScript", () => {
  it("stays blocked while the spend limit is 0 and never calls the LLM", async () => {
    const provider = new FakeLlmProvider({ kind: "output", output: goodDraft });
    const id = await newRequest();
    const outcome = await draftScript({ pool, provider, store, logger }, id);
    expect(outcome).toEqual({ kind: "blocked", code: "SPEND_LIMIT_REACHED" });
    expect(provider.calls).toHaveLength(0);
    expect(await requestRow(id)).toMatchObject({
      status: "blocked",
      error_code: "SPEND_LIMIT_REACHED",
    });
  });

  it("drafts a script that cites the verified claim and records the usage", async () => {
    await setLimits(1, 10);
    const provider = new FakeLlmProvider({ kind: "output", output: goodDraft }, 0.01);
    const id = await newRequest();
    const outcome = await draftScript({ pool, provider, store, logger }, id);
    expect(outcome).toMatchObject({ kind: "succeeded", qaPassed: true });

    const row = await requestRow(id);
    expect(row?.status).toBe("succeeded");
    const { rows } = await pool.query<{
      status: string;
      created_by: string;
      prompt_version: string;
      llm_usage_id: string | null;
      qa_report: { passed: boolean };
    }>(
      "select status, created_by, prompt_version, llm_usage_id, qa_report from public.scripts where id = $1",
      [row?.script_id],
    );
    expect(rows[0]).toMatchObject({
      status: "draft",
      created_by: userId,
      prompt_version: "script.generate@1",
      qa_report: { passed: true },
    });
    expect(rows[0]?.llm_usage_id).not.toBeNull();
    // The prompt only carries claim ids and texts, never raw source excerpts.
    expect(provider.calls[0]?.user).toContain(claimId);

    // Running the same request again does nothing.
    expect(await draftScript({ pool, provider, store, logger }, id)).toEqual({ kind: "skipped" });
    expect(provider.calls).toHaveLength(1);
  });

  it("fails on an invalid answer", async () => {
    await setLimits(1, 10);
    const provider = new FakeLlmProvider({ kind: "output", output: () => ({ lines: "nope" }) });
    const id = await newRequest();
    expect(await draftScript({ pool, provider, store, logger }, id)).toEqual({
      kind: "failed",
      code: "VALIDATION_FAILED",
    });
  });

  it("fails right away while the LLM is disabled", async () => {
    await setLimits(1, 10);
    const id = await newRequest();
    const outcome = await draftScript(
      { pool, provider: new DisabledLlmProvider(), store, logger },
      id,
    );
    expect(outcome).toEqual({ kind: "failed", code: "FORBIDDEN" });
  });
});
