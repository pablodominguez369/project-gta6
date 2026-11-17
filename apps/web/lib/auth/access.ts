import { hasAnyRole, isMember, type AppRole } from "@gta6/domain";

export type AccessDecision = "allow" | "unauthenticated" | "forbidden";

/** Pure access decision, shared by pages, server actions and tests. */
export function decideAccess(
  user: { readonly roles: readonly AppRole[] } | null,
  required: readonly AppRole[] | "member",
): AccessDecision {
  if (!user) {
    return "unauthenticated";
  }
  const allowed = required === "member" ? isMember(user.roles) : hasAnyRole(user.roles, required);
  return allowed ? "allow" : "forbidden";
}
