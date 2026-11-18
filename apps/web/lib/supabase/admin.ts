import "server-only";

import { createAdminClient, type TypedSupabaseClient } from "@gta6/db";

import { serverEnv } from "../env";

/**
 * Client with the Supabase SECRET key: it bypasses RLS. Only for server code that has already
 * checked the user's role (OAuth callback). Never import it from a client component.
 */
export function createSupabaseAdminClient(): TypedSupabaseClient {
  const env = serverEnv();
  return createAdminClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
}
