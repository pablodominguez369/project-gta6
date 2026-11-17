import { defineConfig } from "vitest/config";

// End-to-end tests: need `pnpm supabase start` and a running web server (see e2e/README.md).
export default defineConfig({
  test: {
    include: ["e2e/**/*.e2e.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
