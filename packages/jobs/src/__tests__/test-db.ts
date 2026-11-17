import { randomBytes } from "node:crypto";

import pg from "pg";

/** Local Supabase CLI defaults (public, development-only values). */
export const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  ["postgresql://postgres", "postgres@127.0.0.1:54322/postgres"].join(":");

if (!/@(127\.0\.0\.1|localhost):/.test(testDatabaseUrl)) {
  throw new Error("integration tests only run against a local database");
}

export function uniqueSchema(): string {
  return `pgboss_test_${randomBytes(4).toString("hex")}`;
}

export async function dropSchema(schema: string): Promise<void> {
  const client = new pg.Client({ connectionString: testDatabaseUrl });
  await client.connect();
  try {
    await client.query(`drop schema if exists "${schema}" cascade`);
  } finally {
    await client.end();
  }
}

export async function waitFor(condition: () => boolean, timeoutMs = 20_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
