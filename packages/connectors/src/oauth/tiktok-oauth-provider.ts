import { ok, type DomainError, type Result } from "@gta6/domain";
import { z } from "zod";

import {
  addSeconds,
  type OAuthFetch,
  type OAuthClientConfig,
  type OAuthProvider,
  type TokenSet,
} from "./oauth-provider";
import { postTokenForm } from "./token-request";

/**
 * https://developers.tiktok.com/doc/login-kit-web and the OAuth v2 migration bulletin (checked
 * 2026-11-18). Access tokens last 2 hours, refresh tokens 180 days, and every refresh returns a
 * NEW refresh token that replaces the old one.
 */
export const TIKTOK_AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
export const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
export const TIKTOK_SCOPES = ["video.publish"] as const;

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1),
  refresh_expires_in: z.number().int().positive(),
  open_id: z.string().min(1),
  scope: z.string().default(""),
  token_type: z.string().optional(),
});

export class TikTokOAuthProvider implements OAuthProvider {
  readonly platform = "tiktok" as const;
  readonly scopes = TIKTOK_SCOPES;

  /** `config.clientId` is TikTok's "client key". */
  constructor(
    private readonly config: OAuthClientConfig,
    private readonly fetchImpl: OAuthFetch = fetch,
  ) {}

  authorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_key: this.config.clientId,
      response_type: "code",
      scope: this.scopes.join(","),
      redirect_uri: this.config.redirectUri,
      state,
    });
    return `${TIKTOK_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string, now = new Date()): Promise<Result<TokenSet, DomainError>> {
    const result = await postTokenForm(
      this.fetchImpl,
      TIKTOK_TOKEN_URL,
      {
        client_key: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: this.config.redirectUri,
      },
      tokenResponseSchema,
    );
    return result.ok ? ok(toTokenSet(result.value, now)) : result;
  }

  async refresh(tokens: TokenSet, now = new Date()): Promise<Result<TokenSet, DomainError>> {
    const result = await postTokenForm(
      this.fetchImpl,
      TIKTOK_TOKEN_URL,
      {
        client_key: this.config.clientId,
        client_secret: this.config.clientSecret,
        grant_type: "refresh_token",
        refresh_token: tokens.refreshToken,
      },
      tokenResponseSchema,
    );
    return result.ok ? ok(toTokenSet(result.value, now)) : result;
  }
}

function toTokenSet(response: z.infer<typeof tokenResponseSchema>, now: Date): TokenSet {
  return {
    v: 1,
    platform: "tiktok",
    accessToken: response.access_token,
    accessTokenExpiresAt: addSeconds(now, response.expires_in),
    refreshToken: response.refresh_token,
    refreshTokenExpiresAt: addSeconds(now, response.refresh_expires_in),
    scopes: response.scope.split(",").filter(Boolean),
    accountId: response.open_id,
  };
}
