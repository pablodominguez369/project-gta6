import { DomainError, err, ok, type Result } from "@gta6/domain";

import type { SecretStore } from "../secrets/secret-store";
import { createOAuthProvider } from "./create-oauth-provider";
import type { OAuthFetch, OAuthPlatform, OAuthProvider } from "./oauth-provider";

/** Path of the OAuth callback in the web app. Register APP_BASE_URL + this path on each platform. */
export const OAUTH_CALLBACK_PATH = "/admin/channels/oauth/callback";

/** The OAuth settings from the environment (see platformOAuthEnvSchema in @gta6/config). */
export interface OAuthAppSettings {
  readonly APP_BASE_URL?: string | undefined;
  readonly YOUTUBE_OAUTH_CLIENT_ID?: string | undefined;
  readonly YOUTUBE_OAUTH_CLIENT_SECRET_REF?: string | undefined;
  readonly TIKTOK_OAUTH_CLIENT_KEY?: string | undefined;
  readonly TIKTOK_OAUTH_CLIENT_SECRET_REF?: string | undefined;
}

function clientOf(
  platform: OAuthPlatform,
  settings: OAuthAppSettings,
): { clientId: string; secretRef: string } | null {
  const clientId =
    platform === "youtube" ? settings.YOUTUBE_OAUTH_CLIENT_ID : settings.TIKTOK_OAUTH_CLIENT_KEY;
  const secretRef =
    platform === "youtube"
      ? settings.YOUTUBE_OAUTH_CLIENT_SECRET_REF
      : settings.TIKTOK_OAUTH_CLIENT_SECRET_REF;
  return clientId && secretRef ? { clientId, secretRef } : null;
}

export function redirectUriOf(settings: OAuthAppSettings): string | null {
  return settings.APP_BASE_URL
    ? new URL(OAUTH_CALLBACK_PATH, settings.APP_BASE_URL).toString()
    : null;
}

/** Whether the owner configured this platform's OAuth app (no secret is read). */
export function isOAuthConfigured(platform: OAuthPlatform, settings: OAuthAppSettings): boolean {
  return clientOf(platform, settings) !== null && redirectUriOf(settings) !== null;
}

/** Builds the provider, resolving the client secret at the moment of use (ADR 0003). */
export async function loadOAuthProvider(
  platform: OAuthPlatform,
  settings: OAuthAppSettings,
  secrets: SecretStore,
  fetchImpl?: OAuthFetch,
): Promise<Result<OAuthProvider, DomainError>> {
  const client = clientOf(platform, settings);
  const redirectUri = redirectUriOf(settings);
  if (!client || !redirectUri) {
    return err(new DomainError("FORBIDDEN", "OAuth app not configured for this platform"));
  }
  const secret = await secrets.resolve(client.secretRef);
  if (!secret.ok) return secret;
  return ok(
    createOAuthProvider(
      platform,
      { clientId: client.clientId, clientSecret: secret.value, redirectUri },
      fetchImpl,
    ),
  );
}
