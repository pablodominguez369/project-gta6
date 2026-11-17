import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaMessage,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { DomainError, err, ok, type ErrorCode, type Result } from "@gta6/domain";

import type { LlmProvider, LlmRequest, LlmResponse } from "./llm-provider";

/** Default model. Change it with LLM_MODEL; the price table below must know it. */
export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

/**
 * Prices per million tokens. Source: Anthropic's published USD list prices (checked 2026-11-17;
 * re-check https://platform.claude.com/docs/en/about-claude/pricing before relying on them).
 * They are used as EUR on purpose: 1 USD is worth less than 1 EUR, so the estimate is on the
 * safe side for the spend gate. Every input token is priced at the full input rate (cache
 * discounts ignored), again to over-estimate rather than under-estimate.
 */
export const ANTHROPIC_PRICES_PER_MTOK: Readonly<
  Record<string, { readonly input: number; readonly output: number }>
> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

/** A model missing from the table (e.g. an unexpected fallback) is priced at the highest rate. */
const MAX_PRICE = Object.values(ANTHROPIC_PRICES_PER_MTOK).reduce(
  (max, price) => ({
    input: Math.max(max.input, price.input),
    output: Math.max(max.output, price.output),
  }),
  { input: 0, output: 0 },
);

function priceOf(model: string): { input: number; output: number } {
  return ANTHROPIC_PRICES_PER_MTOK[model] ?? MAX_PRICE;
}

function costEur(model: string, inputTokens: number, outputTokens: number): number {
  const price = priceOf(model);
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

/**
 * Upper bound on input tokens without calling the API: Spanish and JSON average well above two
 * characters per token, so length / 2 over-estimates. Plus room for the output schema.
 */
function maxInputTokens(request: LlmRequest): number {
  const chars =
    request.system.length + request.user.length + JSON.stringify(request.outputSchema).length;
  return Math.ceil(chars / 2) + 1_000;
}

/** The SDK adds the provider request id to each response as `_request_id`. */
export type ProviderMessage = BetaMessage & { readonly _request_id?: string | null };
export type CreateBetaMessage = (
  params: MessageCreateParamsNonStreaming,
) => Promise<ProviderMessage>;

export interface AnthropicLlmOptions {
  readonly model?: string | undefined;
  /** Thinking depth. Opus 5.5 defaults to "medium"; scripts need careful work. */
  readonly effort?: "low" | "medium" | "high";
  /** Injected in tests; defaults to the real SDK client. */
  readonly create?: CreateBetaMessage;
  /** Request timeout in milliseconds. */
  readonly timeoutMs?: number;
}

/**
 * Claude through Anthropic's Messages API with structured JSON output. Disabled unless the worker
 * is configured with LLM_PROVIDER=anthropic and a secret reference to the API key, and every call
 * still goes through the spend gate (0 EUR by default).
 *
 * - No SDK retries: a retried call could be billed twice; the job queue retries through the gate.
 * - Server-side fallback ("default"): if the model declines for safety reasons, the API may rerun
 *   the request on another model in the same call. The answering model is reported and priced.
 * - A timeout is reported as AMBIGUOUS_EXTERNAL_STATE: the call may have been billed.
 */
export class AnthropicLlmProvider implements LlmProvider {
  readonly name = "anthropic";
  private readonly model: string;
  private readonly effort: "low" | "medium" | "high";
  private readonly create: CreateBetaMessage;

  constructor(apiKey: string, options: AnthropicLlmOptions = {}) {
    this.model = options.model ?? DEFAULT_ANTHROPIC_MODEL;
    this.effort = options.effort ?? "high";
    if (options.create) {
      this.create = options.create;
    } else {
      const client = new Anthropic({
        apiKey,
        maxRetries: 0,
        timeout: options.timeoutMs ?? 5 * 60_000,
      });
      this.create = (params) => client.beta.messages.create(params);
    }
  }

  maxCostEur(request: LlmRequest): number {
    // Fallbacks may answer with another model: price the worst case at the highest known rate.
    return (
      (maxInputTokens(request) * MAX_PRICE.input + request.maxOutputTokens * MAX_PRICE.output) /
      1_000_000
    );
  }

  async generate(request: LlmRequest): Promise<Result<LlmResponse, DomainError>> {
    let message: ProviderMessage;
    try {
      message = await this.create({
        model: this.model,
        max_tokens: request.maxOutputTokens,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: {
          effort: this.effort,
          format: { type: "json_schema", schema: { ...request.outputSchema } },
        },
        system: request.system,
        messages: [{ role: "user", content: request.user }],
      });
    } catch (error) {
      return err(toDomainError(error));
    }

    const inputTokens =
      message.usage.input_tokens +
      (message.usage.cache_creation_input_tokens ?? 0) +
      (message.usage.cache_read_input_tokens ?? 0);
    const outputTokens = message.usage.output_tokens;
    const usage = {
      provider: this.name,
      model: message.model,
      inputTokens,
      outputTokens,
      costEur: costEur(message.model, inputTokens, outputTokens),
      requestId: message._request_id ?? null,
    };
    const details = { model: message.model, inputTokens, outputTokens, costEur: usage.costEur };

    if (message.stop_reason === "refusal") {
      return err(
        new DomainError("CONTENT_REFUSED", "The model declined the request", {
          details: { ...details, category: message.stop_details?.category ?? null },
        }),
      );
    }
    if (message.stop_reason !== "end_turn") {
      return err(
        new DomainError("VALIDATION_FAILED", "The model output is incomplete", {
          details: { ...details, stopReason: message.stop_reason ?? null },
        }),
      );
    }
    const text = message.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("");
    let output: unknown;
    try {
      output = JSON.parse(text);
    } catch {
      return err(new DomainError("VALIDATION_FAILED", "The model output is not JSON", { details }));
    }
    return ok({ output, ...usage });
  }
}

function toDomainError(error: unknown): DomainError {
  const code: ErrorCode =
    // Includes APIConnectionTimeoutError: the request may have reached the API and been billed.
    error instanceof Anthropic.APIConnectionError
      ? "AMBIGUOUS_EXTERNAL_STATE"
      : error instanceof Anthropic.RateLimitError
        ? "RATE_LIMITED"
        : error instanceof Anthropic.AuthenticationError
          ? "CREDENTIAL_EXPIRED"
          : error instanceof Anthropic.PermissionDeniedError
            ? "FORBIDDEN"
            : error instanceof Anthropic.BadRequestError
              ? "VALIDATION_FAILED"
              : error instanceof Anthropic.APIError
                ? "EXTERNAL_UNAVAILABLE"
                : "INTERNAL";
  const rawStatus: unknown =
    error instanceof Anthropic.APIError ? (error as { status?: unknown }).status : null;
  const status = typeof rawStatus === "number" ? rawStatus : null;
  // The SDK error message never contains the API key; still, only the status goes in details.
  return new DomainError(code, "LLM provider call failed", { details: { status }, cause: error });
}
