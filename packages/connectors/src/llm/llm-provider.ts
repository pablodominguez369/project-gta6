import type { DomainError, Result } from "@gta6/domain";

/**
 * Provider-neutral LLM contract (rule 9). Prompts are versioned in code and rendered before they
 * reach the provider; outputs are structured (JSON Schema) and validated by the caller with Zod.
 * Prompts and outputs are never logged or stored in llm_usage.
 */
export interface LlmRequest {
  /** Stable prompt name, e.g. "script.generate". */
  readonly promptId: string;
  readonly promptVersion: string;
  /** Rendered system instructions. */
  readonly system: string;
  /** Rendered user message (the material the model works on). */
  readonly user: string;
  /** JSON Schema of the expected structured output. */
  readonly outputSchema: Readonly<Record<string, unknown>>;
  /** Hard ceiling on output tokens (thinking included); also bounds the worst-case cost. */
  readonly maxOutputTokens: number;
}

export interface LlmResponse {
  /** Parsed JSON output, still unvalidated: the caller checks it with its Zod schema. */
  readonly output: unknown;
  readonly provider: string;
  /** Model that actually answered (may differ from the requested one after a fallback). */
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costEur: number;
  /** Provider request id, for support tickets. Never a secret. */
  readonly requestId: string | null;
}

export interface LlmProvider {
  readonly name: string;
  /**
   * Upper bound of what `generate` can cost for this request, in EUR, computed without calling
   * the provider. The spend gate checks it before every call.
   */
  maxCostEur(request: LlmRequest): number;
  generate(request: LlmRequest): Promise<Result<LlmResponse, DomainError>>;
}
