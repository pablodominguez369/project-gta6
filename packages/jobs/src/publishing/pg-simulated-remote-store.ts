import type { ExternalPublication, ExternalStatus, SimulatedRemoteStore } from "@gta6/connectors";
import type pg from "pg";

interface PostRow {
  external_id: string;
  permalink: string | null;
  status: ExternalStatus;
}

const toPublication = (row: PostRow): ExternalPublication => ({
  externalId: row.external_id,
  permalink: row.permalink,
  status: row.status,
});

/**
 * Persistent "remote platform" for the SimulatedPublisher (table simulated_platform_posts), so
 * simulated posts survive worker restarts and duplicates can be counted in tests.
 * Like a non-idempotent platform, it stores duplicates; lookups return the oldest post.
 */
export class PgSimulatedRemoteStore implements SimulatedRemoteStore {
  constructor(private readonly pool: pg.Pool) {}

  async findByIdempotencyKey(key: string): Promise<ExternalPublication | null> {
    const { rows } = await this.pool.query<PostRow>(
      `select external_id, permalink, status from public.simulated_platform_posts
        where idempotency_key = $1 order by created_at, id limit 1`,
      [key],
    );
    return rows[0] ? toPublication(rows[0]) : null;
  }

  async findByExternalId(externalId: string): Promise<ExternalPublication | null> {
    const { rows } = await this.pool.query<PostRow>(
      `select external_id, permalink, status from public.simulated_platform_posts
        where external_id = $1`,
      [externalId],
    );
    return rows[0] ? toPublication(rows[0]) : null;
  }

  async save(key: string, publication: ExternalPublication): Promise<void> {
    await this.pool.query(
      `insert into public.simulated_platform_posts (idempotency_key, external_id, permalink, status)
       values ($1, $2, $3, $4)`,
      [key, publication.externalId, publication.permalink, publication.status],
    );
  }

  async count(): Promise<number> {
    const { rows } = await this.pool.query<{ n: number }>(
      "select count(*)::int as n from public.simulated_platform_posts",
    );
    return rows[0]?.n ?? 0;
  }
}
