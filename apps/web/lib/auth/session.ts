import "server-only";

import { isAppRole, type AppRole } from "@gta6/domain";
import { cache } from "react";

import { createSupabaseServerClient } from "../supabase/server";

export interface SessionUser {
  readonly id: string;
  readonly email: string | null;
  readonly roles: readonly AppRole[];
}

/**
 * Current user and roles, or null when not signed in. Cached per request.
 * Roles are read through RLS (users can only read their own assignments).
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createSupabaseServerClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (claimsError || !claims?.sub) {
    return null;
  }

  const { data: roleRows, error: rolesError } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", claims.sub);
  if (rolesError) {
    throw new Error("Failed to load user roles", { cause: rolesError });
  }

  const roles = (roleRows as { role: string }[]).map((row) => row.role).filter(isAppRole);
  return {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
    roles,
  };
});
