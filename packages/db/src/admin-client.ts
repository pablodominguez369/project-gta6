import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

export type TypedSupabaseClient = SupabaseClient<Database>;

/**
 * Client authenticated with the Supabase secret key. It BYPASSES RLS: use it only in the
 * worker and in server-side code that has already authorized the caller. Never in the browser.
 */
export function createAdminClient(url: string, secretKey: string): TypedSupabaseClient {
  return createClient<Database>(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}
