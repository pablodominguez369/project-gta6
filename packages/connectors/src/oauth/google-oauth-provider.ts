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

/** https://developers.google.com/identity/protocols/oauth2/web-server (checked 2026-11-18). */
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Upload, plus read-only access to look up the status of our own uploads (videos.list). */
export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
] as const;

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1).optional(),
  refresh_token_expires_in: z.number().int().positive().optional(),
  scope: z.string().default(""),
  token_type: z.string(),
});

export class GoogleOAuthProvider implements OAuthProvider {
  readonly platform = "youtube" as const;
  readonly scopes = YOUTUBE_SCOPES;

  constructor(
    private readonly config: OAuthClientConfig,
    private readonly fetchImpl: OAuthFetch = fetch,
  ) {}

  authorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: this.scopes.join(" "),
      // offline + consent: Google only returns a refresh token on consent.
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    });
    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string, now = new Date()): Promise<Result<TokenSet, DomainError>> {
    const result = await postTokenForm(
      this.fetchImpl,
      GOOGLE_TOKEN_URL,
      {
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: this.config.redirectUri,
      },
      tokenResponseSchema.extend({ refresh_token: z.string().min(1) }),
    );
    if (!result.ok) return result;
    return ok(this.toTokenSet(result.value, result.value.refresh_token, now));
  }

  async refresh(tokens: TokenSet, now = new Date()): Promise<Result<TokenSet, DomainError>> {
    const result = await postTokenForm(
      this.fetchImpl,
      GOOGLE_TOKEN_URL,
      {
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: tokens.refreshToken,
        grant_type: "refresh_token",
      },
      tokenResponseSchema,
    );
    if (!result.ok) return result;
    // Google keeps the same refresh token unless it sends a new one.
    return ok(
      this.toTokenSet(result.value, result.value.refresh_token ?? tokens.refreshToken, now),
    );
  }

  private toTokenSet(
    response: z.infer<typeof tokenResponseSchema>,
    refreshToken: string,
    now: Date,
  ): TokenSet {
    return {
      v: 1,
      platform: "youtube",
      accessToken: response.access_token,
      accessTokenExpiresAt: addSeconds(now, response.expires_in),
      refreshToken,
      refreshTokenExpiresAt:
        response.refresh_token_expires_in === undefined
          ? null
          : addSeconds(now, response.refresh_token_expires_in),
      scopes: response.scope.split(" ").filter(Boolean),
      accountId: null,
    };
  }
}
