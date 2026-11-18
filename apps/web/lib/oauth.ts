import "server-only";

import { timingSafeEqual } from "node:crypto";

import {
  CompositeSecretStore,
  EnvSecretStore,
  isOAuthConfigured,
  loadOAuthProvider,
  OAUTH_PLATFORMS,
  VaultSecretStore,
  type OAuthPlatform,
  type OAuthProvider,
} from "@gta6/connectors/oauth";
import type { DomainError, Result } from "@gta6/domain";

import { serverEnv } from "./env";
import { createSupabaseAdminClient } from "./supabase/admin";

/** Short-lived cookie that ties the callback to the admin who started the connection. */
export const OAUTH_STATE_COOKIE = "gta6_oauth_state";
export const OAUTH_STATE_MAX_AGE_S = 600;

export function isOAuthPlatform(platform: string): platform is OAuthPlatform {
  return (OAUTH_PLATFORMS as readonly string[]).includes(platform);
}

export function oauthConfigured(platform: string): boolean {
  return isOAuthPlatform(platform) && isOAuthConfigured(platform, serverEnv());
}

/** env:// only works locally (ADR 0003); vault:// is read with the secret key. */
function secretStore(): CompositeSecretStore {
  const env = serverEnv();
  return new CompositeSecretStore([
    new EnvSecretStore(env.APP_ENV),
    new VaultSecretStore(async (secretRef) => {
      const { data, error } = await createSupabaseAdminClient().rpc("read_vault_secret", {
        secret_ref: secretRef,
      });
      if (error) throw new Error("vault read failed");
      return data;
    }),
  ]);
}

export function oauthProvider(
  platform: OAuthPlatform,
): Promise<Result<OAuthProvider, DomainError>> {
  return loadOAuthProvider(platform, serverEnv(), secretStore());
}

export function sameState(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Absolute URL of a panel path for redirects. Uses APP_BASE_URL when set (production), else the
 * request's own host, so a local run on 127.0.0.1 keeps its session cookie.
 */
export function panelUrl(request: Request, path: string): URL {
  const base = serverEnv().APP_BASE_URL;
  if (base) return new URL(path, base);
  const host = request.headers.get("host");
  const protocol = new URL(request.url).protocol;
  return new URL(path, host ? `${protocol}//${host}` : request.url);
}
