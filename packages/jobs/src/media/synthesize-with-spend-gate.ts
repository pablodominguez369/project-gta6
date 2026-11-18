import type { TtsProvider, TtsRequest, TtsResult } from "@gta6/connectors";
import { checkSpend, err, ok, type DomainError, type Result } from "@gta6/domain";
import type { Logger } from "@gta6/observability";

import type { LlmUsageStore } from "../llm/llm-usage-store";

export interface TtsGateDeps {
  readonly tts: TtsProvider;
  /** Same metered-usage table and limits as the LLM: one budget for all AI spend. */
  readonly store: LlmUsageStore;
  readonly logger: Logger;
  readonly now?: () => Date;
}

export const TTS_PURPOSE = "tts.synthesize";

/**
 * The only way the app calls a TTS provider (rule 8): checks the worst-case cost under the spend
 * lock (a 0 limit blocks everything), calls the provider, records the usage, and records the
 * worst case when the outcome is unknown.
 */
export async function synthesizeWithSpendGate(
  deps: TtsGateDeps,
  request: TtsRequest,
): Promise<Result<TtsResult, DomainError>> {
  const now = deps.now ?? (() => new Date());
  const { tts, store, logger } = deps;
  return store.withSpendLock(async () => {
    const maxCostEur = tts.maxCostEur(request.text);
    const allowed = checkSpend({ ...(await store.loadSpend(now())), maxCostEur });
    if (!allowed.ok) {
      logger.warn({ errorCode: allowed.error.code, provider: tts.name }, "TTS call blocked");
      return allowed;
    }
    const result = await tts.synthesize(request);
    if (result.ok) {
      await store.record({
        provider: result.value.provider,
        model: result.value.model,
        purpose: TTS_PURPOSE,
        inputTokens: result.value.characters,
        outputTokens: 0,
        costEur: result.value.costEur,
        requestId: result.value.requestId,
      });
      return ok(result.value);
    }
    if (result.error.code === "AMBIGUOUS_EXTERNAL_STATE") {
      await store.record({
        provider: tts.name,
        model: "unknown",
        purpose: TTS_PURPOSE,
        inputTokens: request.text.length,
        outputTokens: 0,
        costEur: maxCostEur,
        requestId: null,
      });
    }
    logger.warn({ errorCode: result.error.code, provider: tts.name }, "TTS call failed");
    return err(result.error);
  });
}
