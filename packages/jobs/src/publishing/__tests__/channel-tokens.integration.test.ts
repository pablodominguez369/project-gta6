import { randomUUID } from "node:crypto";

import type { OAuthProvider, TokenSet } from "@gta6/connectors";
import { DomainError, err, ok, type Result } from "@gta6/domain";
import { createLogger } from "@gta6/observability";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { testDatabaseUrl } from "../../__tests__/test-db";
import { PgChannelTokens } from "../channel-tokens";

const logger = createLogger({ name: "tokens-it", level: "fatal" });
const pool = new pg.Pool({ connectionString: testDatabaseUrl, max: 4 });
const NOW = new Date("2026-11-18T12:00:00Z");
const channelIds: string[] = [];

afterAll(async () => {
  await pool.query(
    `delete from vault.secrets where id in (
       select public.vault_secret_id(secret_ref) from public.credential_refs
        where channel_id = any($1::uuid[]))`,
    [channelIds],
  );
  await pool.query("delete from public.credential_refs where channel_id = any($1::uuid[])", [
    channelIds,
  ]);
  await pool.query("delete from public.channels where id = any($1::uuid[])", [channelIds]);
  await pool.end();
});

function tokens(overrides: Partial<TokenSet> = {}): TokenSet {
  return {
    v: 1,
    platform: "tiktok",
    accessToken: "at-old",
    accessTokenExpiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
    refreshToken: "rt-old",
    refreshTokenExpiresAt: "2027-05-01T00:00:00.000Z",
    scopes: ["video.publish"],
    accountId: "open-1",
    ...overrides,
  };
}

async function connectedChannel(secret: TokenSet): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into public.channels (platform, display_name) values ('tiktok', 'IT tokens ' || $1)
     returning id`,
    [randomUUID()],
  );
  const id = rows[0]?.id ?? "";
  channelIds.push(id);
  await pool.query("select public.store_channel_credential($1, $2, $3, null, $4)", [
    id,
    JSON.stringify(secret),
    secret.scopes,
    secret.refreshTokenExpiresAt,
  ]);
  return id;
}

function provider(answer: Result<TokenSet, DomainError>): OAuthProvider & { calls: number } {
  const fake = {
    platform: "tiktok" as const,
    scopes: ["video.publish"],
    calls: 0,
    authorizationUrl: () => "https://example.invalid",
    exchangeCode: () => Promise.resolve(answer),
    refresh: () => {
      fake.calls += 1;
      return Promise.resolve(answer);
    },
  };
  return fake;
}

describe("PgChannelTokens", () => {
  it("returns a fresh token without calling the platform", async () => {
    const id = await connectedChannel(
      tokens({ accessTokenExpiresAt: new Date(NOW.getTime() + 3_600_000).toISOString() }),
    );
    const fake = provider(err(new DomainError("INTERNAL", "unused")));
    const source = new PgChannelTokens(
      pool,
      () => Promise.resolve(ok(fake)),
      logger,
      () => NOW,
    );
    expect(await source.getAccessToken(id)).toEqual({
      ok: true,
      value: { accessToken: "at-old", accountId: "open-1" },
    });
    expect(fake.calls).toBe(0);
  });

  it("refreshes a token about to expire and stores the rotated refresh token in Vault", async () => {
    const id = await connectedChannel(tokens());
    const fake = provider(ok(tokens({ accessToken: "at-new", refreshToken: "rt-new" })));
    const source = new PgChannelTokens(
      pool,
      () => Promise.resolve(ok(fake)),
      logger,
      () => NOW,
    );
    const first = await source.getAccessToken(id);
    expect(first.ok && first.value.accessToken).toBe("at-new");

    const { rows } = await pool.query<{ secret: string }>(
      `select public.read_vault_secret(secret_ref) as secret from public.credential_refs
        where channel_id = $1 and status = 'active'`,
      [id],
    );
    expect(JSON.parse(rows[0]?.secret ?? "{}")).toMatchObject({ refreshToken: "rt-new" });
  });

  it("marks the credential expired when the platform rejects the refresh token", async () => {
    const id = await connectedChannel(tokens());
    const fake = provider(err(new DomainError("CREDENTIAL_EXPIRED", "invalid_grant")));
    const source = new PgChannelTokens(
      pool,
      () => Promise.resolve(ok(fake)),
      logger,
      () => NOW,
    );
    const result = await source.getAccessToken(id);
    expect(!result.ok && result.error.code).toBe("CREDENTIAL_EXPIRED");
    const { rows } = await pool.query<{ status: string }>(
      "select status from public.credential_refs where channel_id = $1",
      [id],
    );
    expect(rows).toEqual([{ status: "expired" }]);
    // Next attempt: no active credential, no platform call.
    expect((await source.getAccessToken(id)).ok).toBe(false);
    expect(fake.calls).toBe(1);
  });

  it("keeps the credential on a transient refresh failure", async () => {
    const id = await connectedChannel(tokens());
    const fake = provider(err(new DomainError("EXTERNAL_UNAVAILABLE", "503")));
    const source = new PgChannelTokens(
      pool,
      () => Promise.resolve(ok(fake)),
      logger,
      () => NOW,
    );
    const result = await source.getAccessToken(id);
    expect(!result.ok && result.error.code).toBe("EXTERNAL_UNAVAILABLE");
    const { rows } = await pool.query<{ status: string }>(
      "select status from public.credential_refs where channel_id = $1",
      [id],
    );
    expect(rows).toEqual([{ status: "active" }]);
  });
});
