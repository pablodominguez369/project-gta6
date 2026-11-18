import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { isPublicPath } from "../auth/public-paths";
import { publicEnv } from "../public-env";

/**
 * Refreshes the Supabase session cookie on every request and redirects anonymous users to
 * /login. Role checks happen in the server components and actions, not here.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const env = publicEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          // Cache-Control headers from @supabase/ssr: auth responses must never be cached.
          for (const [key, value] of Object.entries(headers)) {
            response.headers.set(key, value);
          }
        },
      },
    },
  );

  // Validates the JWT (and refreshes it when needed). Do not run code between client creation
  // and this call.
  const { data } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims.sub);
  const isPublic = isPublicPath(request.nextUrl.pathname);

  if (!isAuthenticated && !isPublic) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    return NextResponse.redirect(loginUrl);
  }

  return response;
}
