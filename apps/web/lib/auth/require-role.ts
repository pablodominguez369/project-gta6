import "server-only";

import type { AppRole } from "@gta6/domain";
import { forbidden, redirect } from "next/navigation";

import { decideAccess } from "./access";
import { getSessionUser, type SessionUser } from "./session";

/**
 * Guard for server components and server actions. Redirects anonymous users to /login and
 * answers 403 when the user lacks the required role. Pass "member" for any role.
 */
export async function requireRole(required: readonly AppRole[] | "member"): Promise<SessionUser> {
  const user = await getSessionUser();
  const decision = decideAccess(user, required);
  if (decision === "unauthenticated" || !user) {
    redirect("/login");
  }
  if (decision === "forbidden") {
    forbidden();
  }
  return user;
}
