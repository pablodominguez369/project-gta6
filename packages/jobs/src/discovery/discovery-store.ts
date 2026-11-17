import type { DiscoveredItem } from "@gta6/connectors";
import type { SourceType } from "@gta6/domain";
import type pg from "pg";

export interface DueFeed {
  readonly id: string;
  readonly url: string;
  readonly publisher: string;
  readonly termsUrl: string;
  readonly sourceType: SourceType;
  readonly trustLevel: number;
  readonly lastPolledAt: Date | null;
  readonly consecutiveFailures: number;
}

export interface DiscoveryStore {
  isSystemPaused(): Promise<boolean>;
  /** Enabled feeds whose poll interval has passed. */
  dueFeeds(): Promise<readonly DueFeed[]>;
  /** Inserts new sources; an already known canonical URL is skipped. Returns how many were new. */
  saveItems(feed: DueFeed, items: readonly DiscoveredItem[]): Promise<number>;
  recordSuccess(feedId: string, polledAt: Date): Promise<void>;
  /** Records a failure; disables the feed (and audits it) once `disableAfter` is reached. */
  recordFailure(feedId: string, errorCode: string, disableAfter: number): Promise<boolean>;
}

interface FeedRow {
  id: string;
  url: string;
  publisher: string;
  terms_url: string;
  source_type: SourceType;
  trust_level: number;
  last_polled_at: Date | null;
  consecutive_failures: number;
}

/** Postgres implementation over the worker's direct connection (bypasses RLS; worker only). */
export class PgDiscoveryStore implements DiscoveryStore {
  constructor(private readonly pool: pg.Pool) {}

  async isSystemPaused(): Promise<boolean> {
    const { rows } = await this.pool.query<{ global_paused: boolean }>(
      "select global_paused from public.system_controls",
    );
    return rows[0]?.global_paused ?? true;
  }

  async dueFeeds(): Promise<readonly DueFeed[]> {
    const { rows } = await this.pool.query<FeedRow>(
      `select id, url, publisher, terms_url, source_type, trust_level, last_polled_at,
              consecutive_failures
         from public.feed_sources
        where enabled
          and terms_url is not null
          and (last_polled_at is null
               or last_polled_at <= now() - make_interval(mins => poll_minutes))
        order by last_polled_at nulls first
        limit 50`,
    );
    return rows.map((row) => ({
      id: row.id,
      url: row.url,
      publisher: row.publisher,
      termsUrl: row.terms_url,
      sourceType: row.source_type,
      trustLevel: row.trust_level,
      lastPolledAt: row.last_polled_at,
      consecutiveFailures: row.consecutive_failures,
    }));
  }

  async saveItems(feed: DueFeed, items: readonly DiscoveredItem[]): Promise<number> {
    let inserted = 0;
    for (const item of items) {
      const { rowCount } = await this.pool.query(
        `insert into public.sources (feed_source_id, url, canonical_url, publisher, title,
                                     published_at, observed_at, source_type, trust_level,
                                     excerpt, content_hash)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         on conflict (canonical_url) do nothing`,
        [
          feed.id,
          item.url,
          item.canonicalUrl,
          item.publisher,
          item.title,
          item.publishedAt,
          item.observedAt,
          feed.sourceType,
          feed.trustLevel,
          item.excerpt,
          item.contentHash,
        ],
      );
      inserted += rowCount ?? 0;
    }
    return inserted;
  }

  async recordSuccess(feedId: string, polledAt: Date): Promise<void> {
    await this.pool.query(
      `update public.feed_sources set last_polled_at = $2, consecutive_failures = 0 where id = $1`,
      [feedId, polledAt],
    );
  }

  async recordFailure(feedId: string, errorCode: string, disableAfter: number): Promise<boolean> {
    const { rows } = await this.pool.query<{ enabled: boolean }>(
      `update public.feed_sources
          set consecutive_failures = consecutive_failures + 1,
              last_polled_at = now(),
              enabled = consecutive_failures + 1 < $2
        where id = $1
        returning enabled`,
      [feedId, disableAfter],
    );
    const disabled = rows[0]?.enabled === false;
    if (disabled) {
      await this.pool.query(
        `insert into public.audit_events (actor_type, action, object_type, object_id, safe_details)
         values ('worker', 'feed_sources.auto_disabled', 'feed_sources', $1, $2)`,
        [feedId, JSON.stringify({ errorCode, consecutiveFailures: disableAfter })],
      );
    }
    return disabled;
  }
}
