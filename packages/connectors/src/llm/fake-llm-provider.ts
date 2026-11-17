import { DomainError, err, ok, type Result } from "@gta6/domain";

import type { LlmProvider, LlmRequest, LlmResponse } from "./llm-provider";

export type FakeLlmBehaviour =
  | { readonly kind: "output"; readonly output: (request: LlmRequest) => unknown }
  | { readonly kind: "error"; readonly error: DomainError };

/**
 * Deterministic provider for development and tests: no network, no cost. It answers with whatever
 * the configured function returns, so tests can exercise valid, invalid and refused outputs.
 */
export class FakeLlmProvider implements LlmProvider {
  readonly name = "fake";
  readonly calls: LlmRequest[] = [];

  constructor(
    private behaviour: FakeLlmBehaviour = { kind: "output", output: () => ({}) },
    private readonly costEur = 0,
  ) {}

  respondWith(behaviour: FakeLlmBehaviour): void {
    this.behaviour = behaviour;
  }

  maxCostEur(): number {
    return this.costEur;
  }

  generate(request: LlmRequest): Promise<Result<LlmResponse, DomainError>> {
    this.calls.push(request);
    if (this.behaviour.kind === "error") return Promise.resolve(err(this.behaviour.error));
    return Promise.resolve(
      ok({
        output: this.behaviour.output(request),
        provider: this.name,
        model: "fake-1",
        inputTokens: Math.ceil((request.system.length + request.user.length) / 4),
        outputTokens: 0,
        costEur: this.costEur,
        requestId: null,
      }),
    );
  }
}

/** Provider used while no real one is configured: every call fails, nothing leaves the process. */
export class DisabledLlmProvider implements LlmProvider {
  readonly name = "disabled";

  maxCostEur(): number {
    return 0;
  }

  generate(): Promise<Result<LlmResponse, DomainError>> {
    return Promise.resolve(
      err(new DomainError("FORBIDDEN", "No LLM provider is configured (LLM_PROVIDER=disabled)")),
    );
  }
}
