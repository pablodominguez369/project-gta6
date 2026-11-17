import { describe, expect, it } from "vitest";

import { loadEnv, loadEnvOrThrow } from "../load-env";
import { baseEnvSchema, publicEnvSchema, workerEnvSchema } from "../schemas";

const FAKE_SERVICE_KEY = "fake-service-role-key-for-tests-only";
const FAKE_DB_PASSWORD = "fake-db-password-for-tests";

const validWorkerEnv = {
  APP_ENV: "local",
  LOG_LEVEL: "debug",
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SECRET_KEY: FAKE_SERVICE_KEY,
  DATABASE_URL: `postgresql://postgres:${FAKE_DB_PASSWORD}@127.0.0.1:54322/postgres`,
  PUBLISHING_MODE: "simulated",
};

describe("loadEnv", () => {
  it("returns typed values for a valid environment", () => {
    const result = loadEnv(workerEnvSchema, validWorkerEnv);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.PUBLISHING_MODE).toBe("simulated");
      expect(result.value.LOG_LEVEL).toBe("debug");
    }
  });

  it("applies defaults", () => {
    const result = loadEnv(baseEnvSchema, { APP_ENV: "local" });

    expect(result.ok && result.value.LOG_LEVEL).toBe("info");
  });

  it("names a missing required variable", () => {
    const { DATABASE_URL: _omitted, ...withoutDb } = validWorkerEnv;
    const result = loadEnv(workerEnvSchema, withoutDb);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_FAILED");
      expect(result.error.message).toContain("DATABASE_URL");
      expect(result.error.details).toEqual({ variables: "DATABASE_URL" });
    }
  });

  it("treats empty strings as missing", () => {
    const result = loadEnv(baseEnvSchema, { APP_ENV: "" });

    expect(!result.ok && result.error.message).toContain("APP_ENV");
  });

  it("never includes variable values in the error", () => {
    const result = loadEnv(workerEnvSchema, {
      ...validWorkerEnv,
      APP_ENV: "not-a-real-env",
      DATABASE_URL: `mysql://root:${FAKE_DB_PASSWORD}@db/app`,
      SUPABASE_SECRET_KEY: "short",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const serialized = JSON.stringify(result.error) + result.error.message;
      expect(serialized).toContain("APP_ENV");
      expect(serialized).toContain("DATABASE_URL");
      expect(serialized).toContain("SUPABASE_SECRET_KEY");
      expect(serialized).not.toContain("not-a-real-env");
      expect(serialized).not.toContain(FAKE_DB_PASSWORD);
      expect(serialized).not.toContain("short");
    }
  });

  it("rejects any publishing mode other than simulated", () => {
    const result = loadEnv(workerEnvSchema, { ...validWorkerEnv, PUBLISHING_MODE: "live" });

    expect(!result.ok && result.error.message).toContain("PUBLISHING_MODE");
  });

  it("rejects an invalid public Supabase URL", () => {
    const result = loadEnv(publicEnvSchema, {
      NEXT_PUBLIC_SUPABASE_URL: "not a url",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fake-publishable-key-for-tests",
    });

    expect(!result.ok && result.error.message).toContain("NEXT_PUBLIC_SUPABASE_URL");
  });

  it("loadEnvOrThrow throws a DomainError on invalid input", () => {
    expect(() => loadEnvOrThrow(baseEnvSchema, {})).toThrow(/APP_ENV/);
  });

  it("keeps the LLM disabled by default", () => {
    const result = loadEnv(workerEnvSchema, validWorkerEnv);
    expect(result.ok && result.value.LLM_PROVIDER).toBe("disabled");
  });

  it("requires a secret reference for the real LLM, never a raw key", () => {
    const missing = loadEnv(workerEnvSchema, { ...validWorkerEnv, LLM_PROVIDER: "anthropic" });
    expect(!missing.ok && missing.error.message).toContain("LLM_API_KEY_REF");

    const rawKey = loadEnv(workerEnvSchema, {
      ...validWorkerEnv,
      LLM_PROVIDER: "anthropic",
      LLM_API_KEY_REF: "not a reference",
    });
    expect(rawKey.ok).toBe(false);

    const ok = loadEnv(workerEnvSchema, {
      ...validWorkerEnv,
      LLM_PROVIDER: "anthropic",
      LLM_API_KEY_REF: "env://ANTHROPIC_API_KEY",
    });
    expect(ok.ok).toBe(true);
  });

  it("only allows the fake LLM locally", () => {
    const result = loadEnv(workerEnvSchema, {
      ...validWorkerEnv,
      APP_ENV: "production",
      LLM_PROVIDER: "fake",
    });
    expect(!result.ok && result.error.message).toContain("LLM_PROVIDER");
  });
});
