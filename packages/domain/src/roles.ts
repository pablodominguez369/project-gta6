/** RBAC roles. Must match the `public.app_role` enum in supabase/migrations. */
export const APP_ROLES = [
  "admin",
  "editor",
  "rights_reviewer",
  "publisher",
  "analyst",
  "read_only",
] as const;

export type AppRole = (typeof APP_ROLES)[number];

export function isAppRole(value: string): value is AppRole {
  return (APP_ROLES as readonly string[]).includes(value);
}

/**
 * True when the user holds at least one of the required roles.
 * Roles are not hierarchical: admin does not implicitly hold the others, so every
 * permission check names the roles it accepts explicitly.
 */
export function hasAnyRole(userRoles: readonly AppRole[], required: readonly AppRole[]): boolean {
  return required.some((role) => userRoles.includes(role));
}

/** A member is any user with at least one role. Users without roles see nothing. */
export function isMember(userRoles: readonly AppRole[]): boolean {
  return userRoles.length > 0;
}
