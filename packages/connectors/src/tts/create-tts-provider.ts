import { DomainError, err, ok, type Result } from "@gta6/domain";

import type { SecretStore } from "../secrets/secret-store";
import { DisabledTtsProvider, FakeTtsProvider } from "./fake-tts-provider";
import {
  GoogleTtsProvider,
  parseServiceAccount,
  type GoogleTtsOptions,
} from "./google-tts-provider";
import type { TtsProvider } from "./tts-provider";

export interface TtsProviderConfig {
  readonly provider: "disabled" | "fake" | "google";
  /** Secret reference to the provider credentials (Google: the service account JSON key). */
  readonly credentialsRef?: string | undefined;
}

/**
 * Builds the configured provider. Credentials are resolved from the secret store at start-up and
 * kept only in memory; they are never logged. Any problem returns an error so the caller can fall
 * back to the disabled provider (safe block).
 */
export async function createTtsProvider(
  config: TtsProviderConfig,
  secrets: SecretStore,
  options: GoogleTtsOptions = {},
): Promise<Result<TtsProvider, DomainError>> {
  switch (config.provider) {
    case "disabled":
      return ok(new DisabledTtsProvider());
    case "fake":
      return ok(new FakeTtsProvider());
    case "google": {
      if (!config.credentialsRef) {
        return err(new DomainError("VALIDATION_FAILED", "TTS_CREDENTIALS_REF is required"));
      }
      const json = await secrets.resolve(config.credentialsRef);
      if (!json.ok) return json;
      const account = parseServiceAccount(json.value);
      if (!account.ok) return account;
      return ok(new GoogleTtsProvider(account.value, options));
    }
  }
}
