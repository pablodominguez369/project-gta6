import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { publicEnv } from "../public-env";

/**
 * Supabase client bound to the signed-in user's session (RLS applies).
 * Create one per request; never share it between requests.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const env = publicEnv();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, where cookies are read-only. The proxy refreshes
            // the session on every request, so this write can be skipped safely.
          }
        },
      },
    },
  );
}
