import type { LlmProvider, LlmRequest, LlmResponse } from "@gta6/connectors";
import type { DomainError } from "@gta6/domain";
import { checkSpend, err, ok, type Result } from "@gta6/domain";
import type { Logger } from "@gta6/observability";

import type { LlmUsageStore } from "./llm-usage-store";

export interface SpendGateDeps {
  readonly provider: LlmProvider;
  readonly store: LlmUsageStore;
  readonly logger: Logger;
  readonly now?: () => Date;
}

export interface GatedLlmResult {
  readonly response: LlmResponse;
  /** llm_usage row for this call, to link from the script. */
  readonly usageId: string;
}

/**
 * The only way the app calls an LLM (rule 8). Under the spend lock it:
 * 1. checks that the worst-case cost fits the daily and monthly limits (0 blocks everything);
 * 2. calls the provider;
 * 3. records the real usage, or the worst case when the outcome is unknown (a timeout may still
 *    be billed), so the next check never under-counts.
 * Limits are read fresh every time and never changed here.
 */
export async function generateWithSpendGate(
  deps: SpendGateDeps,
  request: LlmRequest,
): Promise<Result<GatedLlmResult, DomainError>> {
  const now = deps.now ?? (() => new Date());
  const { provider, store, logger } = deps;
  const log = logger.child({ provider: provider.name, promptId: request.promptId });

  return store.withSpendLock(async () => {
    const maxCostEur = provider.maxCostEur(request);
    const spend = await store.loadSpend(now());
    const allowed = checkSpend({ ...spend, maxCostEur });
    if (!allowed.ok) {
      log.warn({ errorCode: allowed.error.code, ...allowed.error.details }, "LLM call blocked");
      return allowed;
    }

    const result = await provider.generate(request);
    const base = { purpose: request.promptId };
    if (result.ok) {
      const { provider: name, model, inputTokens, outputTokens, costEur, requestId } = result.value;
      const usageId = await store.record({
        ...base,
        provider: name,
        model,
        inputTokens,
        outputTokens,
        costEur,
        requestId,
      });
      log.info({ model, inputTokens, outputTokens, costEur }, "LLM call recorded");
      return ok({ response: result.value, usageId });
    }

    const { details, code } = result.error;
    const billedModel = typeof details.model === "string" ? details.model : null;
    if (billedModel !== null) {
      // The provider answered (refusal, truncated or invalid output): that call was billed.
      await store.record({
        ...base,
        provider: provider.name,
        model: billedModel,
        inputTokens: Number(details.inputTokens ?? 0),
        outputTokens: Number(details.outputTokens ?? 0),
        costEur: Number(details.costEur ?? maxCostEur),
        requestId: null,
      });
    } else if (code === "AMBIGUOUS_EXTERNAL_STATE") {
      await store.record({
        ...base,
        provider: provider.name,
        model: "unknown",
        inputTokens: 0,
        outputTokens: 0,
        costEur: maxCostEur,
        requestId: null,
      });
    }
    log.warn({ errorCode: code }, "LLM call failed");
    return err(result.error);
  });
}
