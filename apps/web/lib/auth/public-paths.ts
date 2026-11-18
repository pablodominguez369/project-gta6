/** Paths anyone can open without signing in: the login page and the legal pages platforms link to. */
export const PUBLIC_PATHS = ["/login", "/legal/"] as const;

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(path));
}
