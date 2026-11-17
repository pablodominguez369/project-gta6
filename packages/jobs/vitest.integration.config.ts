import { defineConfig } from "vitest/config";

// Needs a local Postgres (`pnpm db:start`). Uses TEST_DATABASE_URL or the Supabase CLI default.
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
