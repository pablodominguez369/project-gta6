import { loadEnvOrThrow, publicEnvSchema, type PublicEnv } from "@gta6/config";

let cached: PublicEnv | undefined;

/**
 * Public environment. Each variable is referenced literally so Next.js can inline it into
 * client bundles; never spread process.env here.
 */
export function publicEnv(): PublicEnv {
  cached ??= loadEnvOrThrow(publicEnvSchema, {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  return cached;
}
