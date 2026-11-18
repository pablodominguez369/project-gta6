import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRole } from "@/lib/auth/require-role";
import { logger } from "@/lib/logger";
import {
  isOAuthPlatform,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_MAX_AGE_S,
  oauthProvider,
  panelUrl,
} from "@/lib/oauth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Starts connecting a channel's account (T31): admins only. A random state is kept in an
 * httpOnly cookie scoped to the callback path, then the admin is sent to the platform's consent
 * screen. Nothing is stored until the callback succeeds.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  await requireRole(["admin"]);
  const back = panelUrl(request, "/admin/channels");
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return new NextResponse(null, { status: 404 });

  const supabase = await createSupabaseServerClient();
  const { data: channel } = await supabase
    .from("channels")
    .select("id, platform")
    .eq("id", id.data)
    .maybeSingle();
  if (!channel) return new NextResponse(null, { status: 404 });
  if (!isOAuthPlatform(channel.platform)) {
    back.searchParams.set("oauth", "unsupported");
    return NextResponse.redirect(back);
  }
  const provider = await oauthProvider(channel.platform);
  if (!provider.ok) {
    logger.warn({ errorCode: provider.error.code }, "oauth provider not available");
    back.searchParams.set("oauth", "not_configured");
    return NextResponse.redirect(back);
  }

  const state = randomBytes(32).toString("base64url");
  const response = NextResponse.redirect(provider.value.authorizationUrl(state));
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(OAUTH_STATE_COOKIE, JSON.stringify({ state, channelId: channel.id }), {
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:",
    sameSite: "lax",
    path: "/admin/channels/oauth",
    maxAge: OAUTH_STATE_MAX_AGE_S,
  });
  return response;
}
