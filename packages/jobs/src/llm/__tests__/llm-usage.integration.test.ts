import { FakeLlmProvider } from "@gta6/connectors";
import { createLogger } from "@gta6/observability";
import pg from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { testDatabaseUrl } from "../../__tests__/test-db";
import { generateWithSpendGate } from "../generate-with-spend-gate";
import { PgLlmUsageStore } from "../llm-usage-store";

const logger = createLogger({ name: "llm-usage-it", level: "fatal" });
const pool = new pg.Pool({ connectionString: testDatabaseUrl, max: 6 });
const store = new PgLlmUsageStore(pool);
const purpose = "test.spend_gate";
const request = {
  promptId: purpose,
  promptVersion: "1",
  system: "s",
  user: "u",
  outputSchema: {},
  maxOutputTokens: 10,
};

async function setLimits(daily: number, monthly: number): Promise<void> {
  await pool.query(
    "update public.system_controls set daily_spend_limit_eur = $1, monthly_spend_limit_eur = $2",
    [daily, monthly],
  );
}

afterEach(async () => {
  await pool.query("delete from public.llm_usage");
  await setLimits(0, 0);
});

afterAll(async () => {
  await pool.end();
});

describe("PgLlmUsageStore", () => {
  it("blocks with the default 0 limits", async () => {
    await setLimits(0, 0);
    const provider = new FakeLlmProvider();
    const result = await generateWithSpendGate({ provider, store, logger }, request);
    expect(!result.ok && result.error.code).toBe("SPEND_LIMIT_REACHED");
    expect(provider.calls).toHaveLength(0);
  });

  it("records usage and counts today and this month in Madrid time", async () => {
    await setLimits(1, 10);
    const provider = new FakeLlmProvider({ kind: "output", output: () => ({}) }, 0.12345);
    const result = await generateWithSpendGate({ provider, store, logger }, request);
    expect(result.ok).toBe(true);

    // A row from yesterday (Madrid) counts for the month but not for today, unless today is
    // the 1st, in which case it belongs to the previous month.
    await pool.query(
      `insert into public.llm_usage (provider, model, purpose, input_tokens, output_tokens, cost_eur, created_at)
       values ('fake', 'fake-1', $1, 0, 0, 2, date_trunc('day', now(), 'Europe/Madrid') - interval '1 hour')`,
      [purpose],
    );
    const spend = await store.loadSpend(new Date());
    expect(spend.dailyLimitEur).toBe(1);
    expect(spend.spentTodayEur).toBeCloseTo(0.1235, 4); // rounded up to 4 decimals
    const firstOfMonth = (
      await pool.query<{ first: boolean }>(
        "select extract(day from now() at time zone 'Europe/Madrid') = 1 as first",
      )
    ).rows[0]?.first;
    expect(spend.spentMonthEur).toBeCloseTo(firstOfMonth ? 0.1235 : 2.1235, 4);
  });

  it("never lets concurrent calls pass the limit together", async () => {
    await setLimits(1, 10);
    const provider = new FakeLlmProvider({ kind: "output", output: () => ({}) }, 0.3);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => generateWithSpendGate({ provider, store, logger }, request)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    const { rows } = await pool.query<{ total: string }>(
      "select sum(cost_eur) as total from public.llm_usage",
    );
    expect(Number(rows[0]?.total)).toBeLessThanOrEqual(1);
  });
});
