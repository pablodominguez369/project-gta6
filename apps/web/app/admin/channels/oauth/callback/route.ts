import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRole } from "@/lib/auth/require-role";
import { logger } from "@/lib/logger";
import {
  isOAuthPlatform,
  OAUTH_STATE_COOKIE,
  oauthProvider,
  panelUrl,
  sameState,
} from "@/lib/oauth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const stateCookieSchema = z.object({ state: z.string().min(32), channelId: z.uuid() });

/**
 * OAuth callback (T31). Checks the admin, the state cookie (CSRF) and the channel, exchanges
 * the code server-side and stores the tokens in Vault through `store_channel_credential`. The
 * tokens never reach the browser or the logs.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const user = await requireRole(["admin"]);
  const url = new URL(request.url);
  const back = panelUrl(request, "/admin/channels");
  const done = (result: string) => {
    back.searchParams.set("oauth", result);
    const response = NextResponse.redirect(back);
    response.headers.set("Cache-Control", "no-store");
    response.cookies.delete({ name: OAUTH_STATE_COOKIE, path: "/admin/channels/oauth" });
    return response;
  };

  const cookieStore = await cookies();
  const saved = parseStateCookie(cookieStore.get(OAUTH_STATE_COOKIE)?.value);
  const state = url.searchParams.get("state") ?? "";
  if (!saved || !sameState(saved.state, state)) return done("invalid_state");
  if (url.searchParams.get("error")) return done("denied");
  const code = url.searchParams.get("code");
  if (!code || code.length > 2048) return done("denied");

  const supabase = await createSupabaseServerClient();
  const { data: channel } = await supabase
    .from("channels")
    .select("id, platform")
    .eq("id", saved.channelId)
    .maybeSingle();
  if (!channel || !isOAuthPlatform(channel.platform)) return done("unsupported");

  const provider = await oauthProvider(channel.platform);
  if (!provider.ok) return done("not_configured");
  const tokens = await provider.value.exchangeCode(code);
  if (!tokens.ok) {
    logger.warn(
      { errorCode: tokens.error.code, platform: channel.platform },
      "oauth exchange failed",
    );
    return done("failed");
  }

  const { error } = await createSupabaseAdminClient().rpc("store_channel_credential", {
    channel_id: channel.id,
    secret: JSON.stringify(tokens.value),
    scopes: tokens.value.scopes,
    // A credential without a known refresh expiry stays valid until it is rejected or revoked.
    ...(tokens.value.refreshTokenExpiresAt
      ? { expires_at: tokens.value.refreshTokenExpiresAt }
      : {}),
    actor_id: user.id,
  });
  if (error) {
    logger.error({ dbErrorCode: error.code }, "storing the channel credential failed");
    return done("failed");
  }
  logger.info({ channelId: channel.id, platform: channel.platform }, "channel account connected");
  return done("connected");
}

function parseStateCookie(raw: string | undefined): z.infer<typeof stateCookieSchema> | null {
  if (!raw) return null;
  try {
    const parsed = stateCookieSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
