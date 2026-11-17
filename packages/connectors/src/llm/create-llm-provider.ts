import { DomainError, err, ok, type Result } from "@gta6/domain";

import type { SecretStore } from "../secrets/secret-store";
import { AnthropicLlmProvider } from "./anthropic-llm-provider";
import { DisabledLlmProvider, FakeLlmProvider } from "./fake-llm-provider";
import type { LlmProvider } from "./llm-provider";

export interface LlmProviderConfig {
  readonly provider: "disabled" | "fake" | "anthropic";
  readonly model?: string | undefined;
  readonly apiKeyRef?: string | undefined;
}

/**
 * Builds the configured provider. The API key is resolved from the secret store at start-up and
 * kept only in memory; it is never logged. Any problem returns an error so the caller can fall
 * back to the disabled provider (safe block).
 */
export async function createLlmProvider(
  config: LlmProviderConfig,
  secrets: SecretStore,
): Promise<Result<LlmProvider, DomainError>> {
  switch (config.provider) {
    case "disabled":
      return ok(new DisabledLlmProvider());
    case "fake":
      return ok(new FakeLlmProvider());
    case "anthropic": {
      if (!config.apiKeyRef) {
        return err(new DomainError("VALIDATION_FAILED", "LLM_API_KEY_REF is required"));
      }
      const key = await secrets.resolve(config.apiKeyRef);
      if (!key.ok) return key;
      return ok(new AnthropicLlmProvider(key.value, { model: config.model }));
    }
  }
}
