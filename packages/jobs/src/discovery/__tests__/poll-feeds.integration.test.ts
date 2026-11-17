import { randomUUID } from "node:crypto";

import { FeedDiscoveryProvider, type FetchLike } from "@gta6/connectors";
import { createLogger } from "@gta6/observability";
import pg from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { testDatabaseUrl } from "../../__tests__/test-db";
import { PgDiscoveryStore, type DueFeed } from "../discovery-store";
import { pollFeeds } from "../poll-feeds";

const logger = createLogger({ name: "discovery-it", level: "fatal" });
const pool = new pg.Pool({ connectionString: testDatabaseUrl, max: 4 });
const store = new PgDiscoveryStore(pool);
const feedIds: string[] = [];

const rss = (slug: string) => `<?xml version="1.0"?><rss version="2.0"><channel>
  <item><title>Noticia ${slug}</title><link>https://news.example.test/${slug}?utm_source=x</link>
    <pubDate>${new Date().toUTCString()}</pubDate><description>Resumen</description></item>
  <item><title>Duplicada ${slug}</title><link>https://www.news.example.test/${slug}/</link></item>
</channel></rss>`;

function ok(body: string): FetchLike {
  return () => {
    const response = new Response(body, { status: 200 });
    Object.defineProperty(response, "url", { value: "https://feeds.example.test/feed.xml" });
    return Promise.resolve(response);
  };
}

const failing: FetchLike = () => Promise.reject(new Error("down"));

async function createFeed(enabled = true): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into public.feed_sources (url, publisher, kind, source_type, trust_level, terms_url,
                                      terms_checked_at, enabled)
     values ($1, 'IT Press', 'rss', 'press', 2, 'https://feeds.example.test/terms', now(), $2)
     returning id`,
    [`https://feeds.example.test/${randomUUID()}.xml`, enabled],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("feed not created");
  feedIds.push(id);
  return id;
}

function deps(fetchFor: (feed: DueFeed) => FetchLike, onlyFeed: string) {
  return {
    // Restrict to this test's feed so other local feeds are never polled.
    store: Object.assign(Object.create(store) as PgDiscoveryStore, {
      dueFeeds: async () => (await store.dueFeeds()).filter((feed) => feed.id === onlyFeed),
    }),
    providerFor: (feed: DueFeed) =>
      new FeedDiscoveryProvider({
        feedUrl: feed.url,
        publisher: feed.publisher,
        termsUrl: feed.termsUrl,
        fetch: fetchFor(feed),
      }),
    logger,
  };
}

afterEach(async () => {
  await pool.query("update public.system_controls set global_paused = false, paused_reason = null");
});

afterAll(async () => {
  for (const id of feedIds) {
    await pool.query("delete from public.sources where feed_source_id = $1", [id]);
    await pool.query("delete from public.feed_sources where id = $1", [id]);
  }
  await pool.end();
});

describe("pollFeeds against Postgres", () => {
  it("stores new sources once, de-duplicated by canonical URL, and marks the feed polled", async () => {
    const feedId = await createFeed();
    const slug = randomUUID();
    const outcome = await pollFeeds(deps(() => ok(rss(slug)), feedId));
    expect(outcome).toMatchObject({ kind: "polled", feeds: 1, newSources: 1, failures: 0 });

    const { rows } = await pool.query<{ canonical_url: string; trust_level: number }>(
      "select canonical_url, trust_level from public.sources where feed_source_id = $1",
      [feedId],
    );
    expect(rows).toEqual([{ canonical_url: `https://news.example.test/${slug}`, trust_level: 2 }]);

    // Not due again right away: the poll interval has not passed.
    expect(await pollFeeds(deps(() => ok(rss(slug)), feedId))).toMatchObject({ feeds: 0 });
  });

  it("disables a feed after repeated failures and audits it", async () => {
    const feedId = await createFeed();
    for (let i = 0; i < 3; i += 1) {
      await pool.query("update public.feed_sources set last_polled_at = null where id = $1", [
        feedId,
      ]);
      await pollFeeds({ ...deps(() => failing, feedId), disableAfter: 3 });
    }
    const { rows } = await pool.query<{ enabled: boolean; consecutive_failures: number }>(
      "select enabled, consecutive_failures from public.feed_sources where id = $1",
      [feedId],
    );
    expect(rows[0]).toEqual({ enabled: false, consecutive_failures: 3 });
    const audit = await pool.query(
      "select 1 from public.audit_events where action = 'feed_sources.auto_disabled' and object_id = $1",
      [feedId],
    );
    expect(audit.rowCount).toBe(1);
  });

  it("does nothing while the global pause is on", async () => {
    const feedId = await createFeed();
    await pool.query(
      "update public.system_controls set global_paused = true, paused_reason = 'it'",
    );
    let fetched = false;
    const outcome = await pollFeeds(
      deps(
        () => () => {
          fetched = true;
          return Promise.reject(new Error("must not be called"));
        },
        feedId,
      ),
    );
    expect(outcome).toEqual({ kind: "paused" });
    expect(fetched).toBe(false);
  });

  it("never polls a disabled feed", async () => {
    const feedId = await createFeed(false);
    expect(await pollFeeds(deps(() => ok(rss(randomUUID())), feedId))).toMatchObject({ feeds: 0 });
  });
});
