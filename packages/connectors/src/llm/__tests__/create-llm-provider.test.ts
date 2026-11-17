import { describe, expect, it } from "vitest";

import { EnvSecretStore } from "../../secrets/secret-store";
import { createLlmProvider } from "../create-llm-provider";

describe("createLlmProvider", () => {
  it("is disabled by default", async () => {
    const result = await createLlmProvider(
      { provider: "disabled" },
      new EnvSecretStore("local", {}),
    );
    expect(result.ok && result.value.name).toBe("disabled");
  });

  it("builds the Anthropic provider from a secret reference", async () => {
    const secrets = new EnvSecretStore("local", { ANTHROPIC_API_KEY: "test-placeholder" });
    const result = await createLlmProvider(
      { provider: "anthropic", apiKeyRef: "env://ANTHROPIC_API_KEY" },
      secrets,
    );
    expect(result.ok && result.value.name).toBe("anthropic");
  });

  it("fails when the secret is missing, so the caller stays disabled", async () => {
    const result = await createLlmProvider(
      { provider: "anthropic", apiKeyRef: "env://ANTHROPIC_API_KEY" },
      new EnvSecretStore("local", {}),
    );
    expect(!result.ok && result.error.code).toBe("NOT_FOUND");
  });

  it("refuses env secrets outside local development", async () => {
    const result = await createLlmProvider(
      { provider: "anthropic", apiKeyRef: "env://ANTHROPIC_API_KEY" },
      new EnvSecretStore("production", { ANTHROPIC_API_KEY: "test-placeholder" }),
    );
    expect(!result.ok && result.error.code).toBe("FORBIDDEN");
  });
});
