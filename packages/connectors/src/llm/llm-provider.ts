import type { DomainError, Result } from "@gta6/domain";

/**
 * Contract only (Phase 1). Implementations arrive in Phase 2 behind this interface so the
 * domain never depends on one vendor (rule 9). Outputs are structured and validated by the
 * caller with Zod; prompts are versioned.
 */
export interface LlmRequest {
  readonly promptId: string;
  readonly promptVersion: string;
  readonly input: Readonly<Record<string, unknown>>;
  /** JSON Schema of the expected structured output. */
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly maxOutputTokens: number;
}

export interface LlmResponse {
  readonly output: unknown;
  readonly provider: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Estimated cost, checked against spend limits before and after the call. */
  readonly estimatedCostEur: number;
}

export interface LlmProvider {
  readonly name: string;
  generate(request: LlmRequest): Promise<Result<LlmResponse, DomainError>>;
}
