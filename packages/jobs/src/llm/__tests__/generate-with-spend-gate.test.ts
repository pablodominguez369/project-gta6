import { FakeLlmProvider, type LlmProvider, type LlmRequest } from "@gta6/connectors";
import { DomainError, err } from "@gta6/domain";
import { createLogger } from "@gta6/observability";
import { describe, expect, it } from "vitest";

import { generateWithSpendGate } from "../generate-with-spend-gate";
import type { LlmUsageRecord, LlmUsageStore, SpendSnapshot } from "../llm-usage-store";

const logger = createLogger({ name: "spend-gate-test", level: "fatal" });

const request: LlmRequest = {
  promptId: "script.generate",
  promptVersion: "1",
  system: "s",
  user: "u",
  outputSchema: {},
  maxOutputTokens: 100,
};

class MemoryUsageStore implements LlmUsageStore {
  readonly records: LlmUsageRecord[] = [];
  locked = 0;
  constructor(private readonly limits: Pick<SpendSnapshot, "dailyLimitEur" | "monthlyLimitEur">) {}

  async withSpendLock<T>(fn: () => Promise<T>): Promise<T> {
    this.locked += 1;
    try {
      return await fn();
    } finally {
      this.locked -= 1;
    }
  }

  loadSpend(): Promise<SpendSnapshot> {
    const spent = this.records.reduce((sum, r) => sum + r.costEur, 0);
    return Promise.resolve({ ...this.limits, spentTodayEur: spent, spentMonthEur: spent });
  }

  record(usage: LlmUsageRecord): Promise<string> {
    this.records.push(usage);
    return Promise.resolve(`usage-${String(this.records.length)}`);
  }
}

describe("generateWithSpendGate", () => {
  it("blocks every call while the limits are 0 (the default) and never calls the provider", async () => {
    const provider = new FakeLlmProvider();
    const store = new MemoryUsageStore({ dailyLimitEur: 0, monthlyLimitEur: 0 });
    const result = await generateWithSpendGate({ provider, store, logger }, request);
    expect(!result.ok && result.error.code).toBe("SPEND_LIMIT_REACHED");
    expect(provider.calls).toHaveLength(0);
    expect(store.records).toHaveLength(0);
  });

  it("records the usage of a successful call and returns its id", async () => {
    const provider = new FakeLlmProvider({ kind: "output", output: () => ({ ok: true }) }, 0.2);
    const store = new MemoryUsageStore({ dailyLimitEur: 1, monthlyLimitEur: 10 });
    const result = await generateWithSpendGate({ provider, store, logger }, request);
    expect(result.ok && result.value.usageId).toBe("usage-1");
    expect(store.records[0]).toMatchObject({ purpose: "script.generate", costEur: 0.2 });
  });

  it("stops once the next worst case would pass the daily limit", async () => {
    const provider = new FakeLlmProvider({ kind: "output", output: () => ({}) }, 0.4);
    const store = new MemoryUsageStore({ dailyLimitEur: 1, monthlyLimitEur: 10 });
    const results = [];
    for (let i = 0; i < 3; i += 1) {
      results.push(await generateWithSpendGate({ provider, store, logger }, request));
    }
    expect(results.map((r) => r.ok)).toEqual([true, true, false]);
    expect(provider.calls).toHaveLength(2);
  });

  it("records the worst case when the outcome is unknown (timeout)", async () => {
    const provider: LlmProvider = {
      name: "flaky",
      maxCostEur: () => 0.3,
      generate: () => Promise.resolve(err(new DomainError("AMBIGUOUS_EXTERNAL_STATE", "timeout"))),
    };
    const store = new MemoryUsageStore({ dailyLimitEur: 1, monthlyLimitEur: 10 });
    const result = await generateWithSpendGate({ provider, store, logger }, request);
    expect(result.ok).toBe(false);
    expect(store.records).toEqual([expect.objectContaining({ model: "unknown", costEur: 0.3 })]);
  });

  it("records billed failures such as a refusal", async () => {
    const provider: LlmProvider = {
      name: "anthropic",
      maxCostEur: () => 0.3,
      generate: () =>
        Promise.resolve(
          err(
            new DomainError("CONTENT_REFUSED", "declined", {
              details: { model: "m", inputTokens: 10, outputTokens: 2, costEur: 0.01 },
            }),
          ),
        ),
    };
    const store = new MemoryUsageStore({ dailyLimitEur: 1, monthlyLimitEur: 10 });
    await generateWithSpendGate({ provider, store, logger }, request);
    expect(store.records).toEqual([expect.objectContaining({ model: "m", costEur: 0.01 })]);
  });

  it("does not record clear failures that were not billed", async () => {
    const provider: LlmProvider = {
      name: "anthropic",
      maxCostEur: () => 0.3,
      generate: () => Promise.resolve(err(new DomainError("RATE_LIMITED", "429"))),
    };
    const store = new MemoryUsageStore({ dailyLimitEur: 1, monthlyLimitEur: 10 });
    await generateWithSpendGate({ provider, store, logger }, request);
    expect(store.records).toHaveLength(0);
    expect(store.locked).toBe(0);
  });
});
