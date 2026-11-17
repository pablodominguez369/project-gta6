import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import {
  AnthropicLlmProvider,
  type CreateBetaMessage,
  type ProviderMessage,
} from "../anthropic-llm-provider";
import type { LlmRequest } from "../llm-provider";

const request: LlmRequest = {
  promptId: "test.prompt",
  promptVersion: "1",
  system: "Responde en JSON.",
  user: "Hola",
  outputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
  maxOutputTokens: 1_000,
};

function message(overrides: Partial<Record<string, unknown>> = {}): ProviderMessage {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [{ type: "text", text: '{"ok":true}' }],
    stop_reason: "end_turn",
    stop_details: null,
    usage: {
      input_tokens: 1_000,
      output_tokens: 500,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    _request_id: "req_123",
    ...overrides,
  } as unknown as ProviderMessage;
}

function providerReturning(result: ProviderMessage | Error) {
  const calls: Parameters<CreateBetaMessage>[0][] = [];
  const create: CreateBetaMessage = (params) => {
    calls.push(params);
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  };
  return { provider: new AnthropicLlmProvider("unused", { create }), calls };
}

describe("AnthropicLlmProvider", () => {
  it("sends a structured-output request with the configured model and fallbacks", async () => {
    const { provider, calls } = providerReturning(message());
    await provider.generate(request);
    expect(calls[0]).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 1_000,
      fallbacks: "default",
      betas: ["server-side-fallback-2026-07-01"],
      output_config: { effort: "high", format: { type: "json_schema" } },
      system: "Responde en JSON.",
      messages: [{ role: "user", content: "Hola" }],
    });
  });

  it("parses the JSON output and prices the call", async () => {
    const { provider } = providerReturning(message());
    const result = await provider.generate(request);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      output: { ok: true },
      provider: "anthropic",
      model: "claude-opus-5-5",
      inputTokens: 1_000,
      outputTokens: 500,
      requestId: "req_123",
    });
    // 1000 * 4 / 1M + 500 * 20 / 1M
    expect(result.value.costEur).toBeCloseTo(0.014, 6);
  });

  it("prices an unknown answering model at the highest known rate", async () => {
    const { provider } = providerReturning(message({ model: "claude-unknown" }));
    const result = await provider.generate(request);
    expect(result.ok && result.value.costEur).toBeCloseTo((1_000 * 5 + 500 * 25) / 1_000_000, 6);
  });

  it("never estimates less than the real cost", async () => {
    const { provider } = providerReturning(
      message({ usage: { input_tokens: 20, output_tokens: 1_000 } }),
    );
    const result = await provider.generate(request);
    expect(result.ok).toBe(true);
    if (result.ok) expect(provider.maxCostEur(request)).toBeGreaterThan(result.value.costEur);
  });

  it("reports a refusal as CONTENT_REFUSED", async () => {
    const { provider } = providerReturning(
      message({ stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber" } }),
    );
    const result = await provider.generate(request);
    expect(!result.ok && result.error.code).toBe("CONTENT_REFUSED");
  });

  it("rejects truncated or non-JSON output", async () => {
    for (const overrides of [
      { stop_reason: "max_tokens" },
      { content: [{ type: "text", text: "no es json" }] },
    ]) {
      const { provider } = providerReturning(message(overrides));
      const result = await provider.generate(request);
      expect(!result.ok && result.error.code).toBe("VALIDATION_FAILED");
    }
  });

  it("maps SDK errors to domain codes", async () => {
    const cases: [Error, string][] = [
      [new Anthropic.APIConnectionTimeoutError(), "AMBIGUOUS_EXTERNAL_STATE"],
      [Anthropic.APIError.generate(429, undefined, "slow down", new Headers()), "RATE_LIMITED"],
      [Anthropic.APIError.generate(401, undefined, "bad key", new Headers()), "CREDENTIAL_EXPIRED"],
      [Anthropic.APIError.generate(400, undefined, "bad", new Headers()), "VALIDATION_FAILED"],
      [
        Anthropic.APIError.generate(529, undefined, "overloaded", new Headers()),
        "EXTERNAL_UNAVAILABLE",
      ],
      [new Error("boom"), "INTERNAL"],
    ];
    for (const [error, code] of cases) {
      const { provider } = providerReturning(error);
      const result = await provider.generate(request);
      expect(!result.ok && result.error.code).toBe(code);
    }
  });
});
