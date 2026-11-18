import type { DomainError, Result } from "@gta6/domain";
import { z } from "zod";

import type { FetchLike } from "../discovery/feed-discovery-provider";

/** Platforms whose accounts can be connected in Phase 4 (Instagram stays manual-only). */
export const OAUTH_PLATFORMS = ["youtube", "tiktok"] as const;
export type OAuthPlatform = (typeof OAUTH_PLATFORMS)[number];

/**
 * What we keep in Vault for a connected channel (version 1). Never logged, never sent to the
 * browser, never stored in a table: credential_refs only has the vault:// reference.
 */
export const tokenSetSchema = z.object({
  v: z.literal(1),
  platform: z.enum(OAUTH_PLATFORMS),
  accessToken: z.string().min(1),
  accessTokenExpiresAt: z.iso.datetime(),
  refreshToken: z.string().min(1),
  /** null when the platform does not say (Google refresh tokens have no fixed expiry). */
  refreshTokenExpiresAt: z.iso.datetime().nullable(),
  scopes: z.array(z.string()),
  /** The platform's id for the account (TikTok open_id); null when not returned. */
  accountId: z.string().nullable(),
});
export type TokenSet = z.infer<typeof tokenSetSchema>;

export interface OAuthClientConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  /** Must exactly match the redirect URI registered in the platform's developer console. */
  readonly redirectUri: string;
}

/** Injected fetch, so tests use a fake and nothing reaches the network. */
export type OAuthFetch = FetchLike;

export interface OAuthProvider {
  readonly platform: OAuthPlatform;
  /** Scopes requested, the minimum the adapter needs (docs/platforms.md). */
  readonly scopes: readonly string[];
  authorizationUrl(state: string): string;
  /** Code from the callback → tokens. CREDENTIAL_EXPIRED when the code is invalid or used. */
  exchangeCode(code: string, now?: Date): Promise<Result<TokenSet, DomainError>>;
  /** CREDENTIAL_EXPIRED when the refresh token is no longer valid: reconnect the account. */
  refresh(tokens: TokenSet, now?: Date): Promise<Result<TokenSet, DomainError>>;
}

export function addSeconds(now: Date, seconds: number): string {
  return new Date(now.getTime() + seconds * 1000).toISOString();
}
