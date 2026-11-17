import { DomainError } from "@gta6/domain";
import { describe, expect, it } from "vitest";

import { DisabledLlmProvider, FakeLlmProvider } from "../fake-llm-provider";
import type { LlmRequest } from "../llm-provider";

const request: LlmRequest = {
  promptId: "p",
  promptVersion: "1",
  system: "s",
  user: "u",
  outputSchema: {},
  maxOutputTokens: 10,
};

describe("FakeLlmProvider", () => {
  it("returns the configured output, costs nothing and records the call", async () => {
    const fake = new FakeLlmProvider({ kind: "output", output: () => ({ hello: "mundo" }) });
    const result = await fake.generate(request);
    expect(result.ok && result.value).toMatchObject({ output: { hello: "mundo" }, costEur: 0 });
    expect(fake.calls).toHaveLength(1);
    expect(fake.maxCostEur()).toBe(0);
  });

  it("can fail on demand", async () => {
    const fake = new FakeLlmProvider();
    fake.respondWith({ kind: "error", error: new DomainError("CONTENT_REFUSED", "no") });
    const result = await fake.generate(request);
    expect(!result.ok && result.error.code).toBe("CONTENT_REFUSED");
  });
});

describe("DisabledLlmProvider", () => {
  it("refuses every call", async () => {
    const result = await new DisabledLlmProvider().generate();
    expect(!result.ok && result.error.code).toBe("FORBIDDEN");
  });
});
