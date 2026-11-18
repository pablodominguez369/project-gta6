import type { Database } from "@gta6/db";
import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser client bound to the user's session cookie (RLS applies). Only used for direct uploads
 * to Storage with a signed upload URL, so large files never pass through a server function.
 */
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Missing public Supabase configuration");
  return createBrowserClient<Database>(url, key);
}
