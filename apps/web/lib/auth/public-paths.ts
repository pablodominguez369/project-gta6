/**
 * Paths anyone can open without signing in: the public home page (Google's app verification
 * requires a homepage that describes the app), the login page and the legal pages platforms
 * link to.
 */
export const PUBLIC_PATHS = ["/login", "/legal/"] as const;

/** Public only as an exact match, so "/" never opens the rest of the site. */
const EXACT_PUBLIC_PATHS = new Set(["/"]);

export function isPublicPath(pathname: string): boolean {
  return (
    EXACT_PUBLIC_PATHS.has(pathname) ||
    PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(path))
  );
}
