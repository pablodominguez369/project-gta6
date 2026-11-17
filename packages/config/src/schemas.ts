import { z } from "zod";

export const APP_ENVS = ["local", "staging", "production"] as const;
export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;

/** Variables every process needs. */
export const baseEnvSchema = z.object({
  APP_ENV: z.enum(APP_ENVS),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
});

/**
 * Public variables, safe to expose to the browser. Only `NEXT_PUBLIC_*` names belong here.
 * Uses Supabase "publishable" keys (`sb_publishable_...`), which replace the legacy anon key.
 */
export const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
});

/**
 * Supabase secret key (`sb_secret_...`, replaces the legacy service_role key). It bypasses RLS,
 * so it is only read by server code and the worker, never by the browser.
 */
const supabaseSecretKey = z.string().min(20);

/** Server-only variables for the Next.js app. Never import this from client code. */
export const webServerEnvSchema = baseEnvSchema.extend(publicEnvSchema.shape).extend({
  SUPABASE_SECRET_KEY: supabaseSecretKey,
});

/**
 * Worker variables. In Phase 1 only the simulated publisher exists, so any other publishing
 * mode is rejected and the worker refuses to start.
 */
export const workerEnvSchema = baseEnvSchema.extend({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: supabaseSecretKey,
  DATABASE_URL: z.url().refine((value) => /^postgres(ql)?:\/\//.test(value)),
  PUBLISHING_MODE: z.literal("simulated"),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;
export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type WebServerEnv = z.infer<typeof webServerEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;
