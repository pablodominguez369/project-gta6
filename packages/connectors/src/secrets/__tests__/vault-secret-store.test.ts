import { describe, expect, it } from "vitest";

import { EnvSecretStore } from "../secret-store";
import { CompositeSecretStore, VaultSecretStore } from "../vault-secret-store";

const REF = "vault://0b2c6b8e-6a0e-4c43-9d2a-1f9e8c7b6a50";

describe("VaultSecretStore", () => {
  it("resolves a vault reference through the reader", async () => {
    const store = new VaultSecretStore((ref) => Promise.resolve(ref === REF ? "s3cret" : null));
    expect(await store.resolve(REF)).toEqual({ ok: true, value: "s3cret" });
  });

  it("answers NOT_FOUND, VALIDATION_FAILED and EXTERNAL_UNAVAILABLE without throwing", async () => {
    const missing = new VaultSecretStore(() => Promise.resolve(null));
    expect(!(await missing.resolve(REF)).ok).toBe(true);
    const bad = await missing.resolve("vault://not-a-uuid");
    expect(!bad.ok && bad.error.code).toBe("VALIDATION_FAILED");
    const down = new VaultSecretStore(() => Promise.reject(new Error("down")));
    const result = await down.resolve(REF);
    expect(!result.ok && result.error.code).toBe("EXTERNAL_UNAVAILABLE");
  });
});

describe("CompositeSecretStore", () => {
  it("routes by scheme", async () => {
    const store = new CompositeSecretStore([
      new EnvSecretStore("local", { CLIENT_SECRET: "from-env" }),
      new VaultSecretStore(() => Promise.resolve("from-vault")),
    ]);
    expect(await store.resolve("env://CLIENT_SECRET")).toEqual({ ok: true, value: "from-env" });
    expect(await store.resolve(REF)).toEqual({ ok: true, value: "from-vault" });
    const unknown = await store.resolve("aws://x");
    expect(!unknown.ok && unknown.error.code).toBe("VALIDATION_FAILED");
  });
});
