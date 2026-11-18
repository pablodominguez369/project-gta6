import { GoogleOAuthProvider } from "./google-oauth-provider";
import type { OAuthFetch, OAuthClientConfig, OAuthPlatform, OAuthProvider } from "./oauth-provider";
import { TikTokOAuthProvider } from "./tiktok-oauth-provider";

export function createOAuthProvider(
  platform: OAuthPlatform,
  config: OAuthClientConfig,
  fetchImpl?: OAuthFetch,
): OAuthProvider {
  switch (platform) {
    case "youtube":
      return new GoogleOAuthProvider(config, fetchImpl);
    case "tiktok":
      return new TikTokOAuthProvider(config, fetchImpl);
  }
}
