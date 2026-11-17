import { describe, expect, it } from "vitest";

import { EnvSecretStore, parseSecretRef } from "../secret-store";

describe("parseSecretRef", () => {
  it("parses scheme and path", () => {
    expect(parseSecretRef("env://YOUTUBE_TOKEN")).toEqual({ scheme: "env", path: "YOUTUBE_TOKEN" });
    expect(parseSecretRef("vault://youtube/channel-1")).toEqual({
      scheme: "vault",
      path: "youtube/channel-1",
    });
  });

  it("rejects raw tokens", () => {
    expect(parseSecretRef("ya29.some-token")).toBeNull();
  });
});

describe("EnvSecretStore", () => {
  const source = { SIM_TOKEN: "local-value" };

  it("resolves env:// refs in local", async () => {
    const result = await new EnvSecretStore("local", source).resolve("env://SIM_TOKEN");
    expect(result).toEqual({ ok: true, value: "local-value" });
  });

  it.each(["staging", "production"] as const)("refuses to run in %s", async (appEnv) => {
    const result = await new EnvSecretStore(appEnv, source).resolve("env://SIM_TOKEN");
    expect(!result.ok && result.error.code).toBe("FORBIDDEN");
  });

  it("does not leak the value in errors", async () => {
    const result = await new EnvSecretStore("local", source).resolve("env://MISSING");
    expect(!result.ok && result.error.code).toBe("NOT_FOUND");
    expect(JSON.stringify(result)).not.toContain("local-value");
  });

  it("rejects other schemes", async () => {
    const result = await new EnvSecretStore("local", source).resolve("vault://a/b");
    expect(!result.ok && result.error.code).toBe("VALIDATION_FAILED");
  });
});
