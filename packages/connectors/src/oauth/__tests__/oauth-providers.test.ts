import { describe, expect, it } from "vitest";

import { EnvSecretStore } from "../../secrets/secret-store";
import { isOAuthConfigured, loadOAuthProvider } from "../configured-providers";
import { GoogleOAuthProvider, GOOGLE_TOKEN_URL } from "../google-oauth-provider";
import type { OAuthFetch, TokenSet } from "../oauth-provider";
import { TikTokOAuthProvider, TIKTOK_TOKEN_URL } from "../tiktok-oauth-provider";

const NOW = new Date("2026-11-18T12:00:00Z");
const config = {
  clientId: "client-id-test",
  clientSecret: "client-secret-test",
  redirectUri: "https://panel.example.test/admin/channels/oauth/callback",
};

interface Call {
  url: string;
  form: URLSearchParams;
}

function fakeFetch(status: number, body: unknown): { fetch: OAuthFetch; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: (url, init) => {
      calls.push({
        url,
        form: new URLSearchParams(typeof init.body === "string" ? init.body : ""),
      });
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );
    },
  };
}

describe("GoogleOAuthProvider", () => {
  it("asks for offline access with the minimal YouTube scopes and the state", () => {
    const url = new URL(new GoogleOAuthProvider(config).authorizationUrl("state-123"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
    );
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
  });

  it("exchanges a code for tokens with expiry times", async () => {
    const { fetch, calls } = fakeFetch(200, {
      access_token: "at-1",
      expires_in: 3599,
      refresh_token: "rt-1",
      scope: "https://www.googleapis.com/auth/youtube.upload",
      token_type: "Bearer",
    });
    const result = await new GoogleOAuthProvider(config, fetch).exchangeCode("code-1", NOW);
    expect(result).toEqual({
      ok: true,
      value: {
        v: 1,
        platform: "youtube",
        accessToken: "at-1",
        accessTokenExpiresAt: "2026-11-18T12:59:59.000Z",
        refreshToken: "rt-1",
        refreshTokenExpiresAt: null,
        scopes: ["https://www.googleapis.com/auth/youtube.upload"],
        accountId: null,
      },
    });
    expect(calls[0]?.url).toBe(GOOGLE_TOKEN_URL);
    expect(calls[0]?.form.get("grant_type")).toBe("authorization_code");
  });

  it("refuses a code exchange without a refresh token", async () => {
    const { fetch } = fakeFetch(200, { access_token: "at", expires_in: 10, token_type: "Bearer" });
    const result = await new GoogleOAuthProvider(config, fetch).exchangeCode("code", NOW);
    expect(!result.ok && result.error.code).toBe("EXTERNAL_UNAVAILABLE");
  });

  it("keeps the refresh token when Google does not send a new one", async () => {
    const { fetch } = fakeFetch(200, {
      access_token: "at-2",
      expires_in: 60,
      token_type: "Bearer",
    });
    const previous: TokenSet = {
      v: 1,
      platform: "youtube",
      accessToken: "at-1",
      accessTokenExpiresAt: NOW.toISOString(),
      refreshToken: "rt-1",
      refreshTokenExpiresAt: null,
      scopes: [],
      accountId: null,
    };
    const result = await new GoogleOAuthProvider(config, fetch).refresh(previous, NOW);
    expect(result.ok && result.value.refreshToken).toBe("rt-1");
    expect(result.ok && result.value.accessToken).toBe("at-2");
  });

  it("maps invalid_grant to CREDENTIAL_EXPIRED without echoing the body", async () => {
    const { fetch } = fakeFetch(400, { error: "invalid_grant", error_description: "rt-1 bad" });
    const result = await new GoogleOAuthProvider(config, fetch).exchangeCode("code", NOW);
    expect(!result.ok && result.error.code).toBe("CREDENTIAL_EXPIRED");
    expect(JSON.stringify(!result.ok && result.error.toJSON())).not.toContain("rt-1");
  });

  it("maps 5xx and network errors to EXTERNAL_UNAVAILABLE", async () => {
    const { fetch } = fakeFetch(503, {});
    expect((await new GoogleOAuthProvider(config, fetch).exchangeCode("c", NOW)).ok).toBe(false);
    const offline: OAuthFetch = () => Promise.reject(new Error("ECONNRESET"));
    const result = await new GoogleOAuthProvider(config, offline).exchangeCode("c", NOW);
    expect(!result.ok && result.error.code).toBe("EXTERNAL_UNAVAILABLE");
  });
});

describe("TikTokOAuthProvider", () => {
  it("builds the Login Kit URL with the client key and video.publish", () => {
    const url = new URL(new TikTokOAuthProvider(config).authorizationUrl("s"));
    expect(url.origin + url.pathname).toBe("https://www.tiktok.com/v2/auth/authorize/");
    expect(url.searchParams.get("client_key")).toBe("client-id-test");
    expect(url.searchParams.get("scope")).toBe("video.publish");
  });

  it("stores the open_id and the rotated refresh token", async () => {
    const { fetch, calls } = fakeFetch(200, {
      access_token: "at-t",
      expires_in: 7200,
      refresh_token: "rt-new",
      refresh_expires_in: 15_552_000,
      open_id: "open-1",
      scope: "video.publish",
      token_type: "Bearer",
    });
    const provider = new TikTokOAuthProvider(config, fetch);
    const result = await provider.exchangeCode("code", NOW);
    expect(result.ok && result.value).toMatchObject({
      accountId: "open-1",
      refreshToken: "rt-new",
      accessTokenExpiresAt: "2026-11-18T14:00:00.000Z",
      scopes: ["video.publish"],
    });
    expect(calls[0]?.url).toBe(TIKTOK_TOKEN_URL);
    expect(calls[0]?.form.get("client_key")).toBe("client-id-test");
  });
});

describe("loadOAuthProvider", () => {
  const settings = {
    APP_BASE_URL: "https://panel.example.test",
    YOUTUBE_OAUTH_CLIENT_ID: "yt-client",
    YOUTUBE_OAUTH_CLIENT_SECRET_REF: "env://YT_SECRET",
  };

  it("is not configured without the client, the secret reference or the base URL", () => {
    expect(isOAuthConfigured("youtube", settings)).toBe(true);
    expect(isOAuthConfigured("tiktok", settings)).toBe(false);
    expect(isOAuthConfigured("youtube", { ...settings, APP_BASE_URL: undefined })).toBe(false);
  });

  it("resolves the client secret and uses the callback path as redirect URI", async () => {
    const result = await loadOAuthProvider(
      "youtube",
      settings,
      new EnvSecretStore("local", { YT_SECRET: "secret" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const url = new URL(result.value.authorizationUrl("s"));
      expect(url.searchParams.get("redirect_uri")).toBe(
        "https://panel.example.test/admin/channels/oauth/callback",
      );
    }
    const missing = await loadOAuthProvider("youtube", settings, new EnvSecretStore("local", {}));
    expect(!missing.ok && missing.error.code).toBe("NOT_FOUND");
  });
});
