import {
  tokenSetSchema,
  type OAuthPlatform,
  type OAuthProvider,
  type TokenSet,
} from "@gta6/connectors";
import { DomainError, err, ok, type Result } from "@gta6/domain";
import type { Logger } from "@gta6/observability";
import type pg from "pg";

/** Refresh when the access token has less than this left, so an upload never starts stale. */
export const REFRESH_MARGIN_MS = 10 * 60_000;

export interface ChannelAccess {
  readonly accessToken: string;
  /** The platform's id for the account (TikTok open_id), when known. */
  readonly accountId: string | null;
}

/** What platform adapters use to get a valid token for a channel. Never logs the token. */
export interface ChannelTokenSource {
  getAccessToken(channelId: string): Promise<Result<ChannelAccess, DomainError>>;
}

export type OAuthProviderLoader = (
  platform: OAuthPlatform,
) => Promise<Result<OAuthProvider, DomainError>>;

/**
 * Reads the channel's active credential from Vault through the worker's direct connection and
 * refreshes it when needed. Runs inside the per-channel publication lock, so two refreshes for
 * the same channel never race (TikTok rotates the refresh token on every refresh).
 */
export class PgChannelTokens implements ChannelTokenSource {
  constructor(
    private readonly pool: pg.Pool,
    private readonly loadProvider: OAuthProviderLoader,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getAccessToken(channelId: string): Promise<Result<ChannelAccess, DomainError>> {
    const { rows } = await this.pool.query<{ id: string; secret_ref: string }>(
      `select cr.id, cr.secret_ref
         from public.credential_refs cr
        where cr.channel_id = $1 and cr.status = 'active'
          and (cr.expires_at is null or cr.expires_at > now())
        order by cr.granted_at desc nulls last
        limit 1`,
      [channelId],
    );
    const credential = rows[0];
    if (!credential) return err(new DomainError("CREDENTIAL_EXPIRED", "No active credential"));

    const { rows: secrets } = await this.pool.query<{ secret: string | null }>(
      "select public.read_vault_secret($1) as secret",
      [credential.secret_ref],
    );
    const tokens = parseTokens(secrets[0]?.secret ?? null);
    if (!tokens) {
      await this.expire(credential.id, "unreadable");
      return err(new DomainError("CREDENTIAL_EXPIRED", "Stored credential is unreadable"));
    }

    const now = this.now();
    if (new Date(tokens.accessTokenExpiresAt).getTime() - now.getTime() > REFRESH_MARGIN_MS) {
      return ok({ accessToken: tokens.accessToken, accountId: tokens.accountId });
    }

    const provider = await this.loadProvider(tokens.platform);
    if (!provider.ok) return provider;
    const refreshed = await provider.value.refresh(tokens, now);
    if (!refreshed.ok) {
      if (refreshed.error.code === "CREDENTIAL_EXPIRED") {
        await this.expire(credential.id, "refresh_rejected");
      }
      return refreshed;
    }
    await this.pool.query("select public.update_vault_secret($1, $2)", [
      credential.secret_ref,
      JSON.stringify(refreshed.value),
    ]);
    await this.pool.query("update public.credential_refs set expires_at = $2 where id = $1", [
      credential.id,
      refreshed.value.refreshTokenExpiresAt,
    ]);
    this.logger.info({ channelId }, "access token refreshed");
    return ok({ accessToken: refreshed.value.accessToken, accountId: refreshed.value.accountId });
  }

  private async expire(credentialId: string, reason: string): Promise<void> {
    await this.pool.query("update public.credential_refs set status = 'expired' where id = $1", [
      credentialId,
    ]);
    this.logger.warn({ credentialId, reason }, "credential marked expired; reconnect the account");
  }
}

function parseTokens(secret: string | null): TokenSet | null {
  if (!secret) return null;
  try {
    const parsed = tokenSetSchema.safeParse(JSON.parse(secret));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
