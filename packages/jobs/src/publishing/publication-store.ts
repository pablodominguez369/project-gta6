import type { ExternalPublication, PlatformCheckpoint } from "@gta6/connectors";
import type {
  AssetOrigin,
  ChannelMode,
  ErrorCode,
  Platform,
  PublicationMedia,
  PublicationStatus,
  RightsStatus,
} from "@gta6/domain";
import type pg from "pg";

import {
  LICENSE_JSON,
  toLicense,
  toVoiceRecord,
  VOICE_COLUMNS,
  type LicenseJson,
  type VoiceRow,
} from "../media/rights-rows";

/** Everything the orchestrator needs for one attempt, read fresh under the channel lock. */
export interface PublicationContext {
  readonly publication: {
    readonly id: string;
    readonly channelId: string;
    readonly status: PublicationStatus;
    readonly idempotencyKey: string;
    readonly payload: unknown;
    readonly reconcileRequired: boolean;
    /** Ids the adapter saved in an earlier attempt (ADR 0005); null when none. */
    readonly platformCheckpoint: PlatformCheckpoint | null;
  };
  readonly channel: {
    readonly platform: Platform;
    readonly mode: ChannelMode;
    readonly paused: boolean;
    readonly liveUploadsEnabled: boolean;
    /** An active credential reference that has not expired. */
    readonly credentialActive: boolean;
    readonly timezone: string;
    readonly maxPostsPerDay: number;
    readonly minMinutesBetweenPosts: number;
  };
  readonly systemPaused: boolean;
  /** published_at of the channel's successful publications in the last 48 hours. */
  readonly recentPublishedAt: readonly Date[];
  /** The linked render with the CURRENT rights of its assets and voice; null when none. */
  readonly media: PublicationMedia | null;
}

/** Status changes the orchestrator may request. Terminal success goes through markSucceeded. */
export type PublicationUpdate =
  | {
      readonly status: "in_progress";
      /** Set right before calling the platform; it is never cleared afterwards. */
      readonly reconcileRequired?: true;
      readonly errorCode?: ErrorCode;
    }
  | { readonly status: "ambiguous" | "failed"; readonly errorCode: ErrorCode }
  | { readonly status: "blocked"; readonly errorCode: ErrorCode; readonly nextAttemptAt: Date };

export interface WorkerAuditEvent {
  readonly action: string;
  readonly publicationId: string;
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
}

export type LockResult<T> =
  { readonly acquired: true; readonly value: T } | { readonly acquired: false };

/** Persistence used by the publication orchestrator. Postgres today; swappable for tests. */
export interface PublicationStore {
  findChannelId(publicationId: string): Promise<string | null>;
  /**
   * Runs `fn` while holding an exclusive lock on the channel, so two attempts for the same
   * channel never interleave (frequency limits and reconciliation stay consistent).
   */
  withChannelLock<T>(channelId: string, fn: () => Promise<T>): Promise<LockResult<T>>;
  loadContext(publicationId: string): Promise<PublicationContext | null>;
  update(publicationId: string, update: PublicationUpdate): Promise<void>;
  markSucceeded(
    publicationId: string,
    external: ExternalPublication,
    publishedAt: Date,
  ): Promise<void>;
  recordAudit(event: WorkerAuditEvent): Promise<void>;
  /** Persists the adapter checkpoint; committed before the adapter continues. */
  saveCheckpoint(publicationId: string, checkpoint: PlatformCheckpoint): Promise<void>;
}

interface ContextRow {
  id: string;
  channel_id: string;
  status: PublicationStatus;
  idempotency_key: string;
  payload_json: unknown;
  reconcile_required: boolean;
  platform_checkpoint: PlatformCheckpoint | null;
  platform: Platform;
  mode: ChannelMode;
  paused: boolean;
  live_uploads_enabled: boolean;
  credential_active: boolean;
  timezone: string;
  max_posts_per_day: number;
  min_minutes_between_posts: number;
  global_paused: boolean;
  recent_published_at: Date[] | null;
  render_id: string | null;
  qc_passed: boolean | null;
  disclosure_required: boolean | null;
  asset_ids: string[] | null;
  voice_id: string | null;
}

/** Updates never touch a terminal row, whatever the caller asks for. */
const NOT_TERMINAL = "status not in ('succeeded', 'failed')";

/**
 * Postgres implementation. Uses a direct connection (the worker's DATABASE_URL), which bypasses
 * RLS like the secret key: it only runs in the worker, never in the web app.
 */
export class PgPublicationStore implements PublicationStore {
  constructor(private readonly pool: pg.Pool) {}

  async findChannelId(publicationId: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ channel_id: string }>(
      "select channel_id from public.publications where id = $1",
      [publicationId],
    );
    return rows[0]?.channel_id ?? null;
  }

  async withChannelLock<T>(channelId: string, fn: () => Promise<T>): Promise<LockResult<T>> {
    // Session-level advisory lock on a dedicated connection: released explicitly, or by Postgres
    // when the connection drops (worker crash), so a lock is never left behind.
    const client = await this.pool.connect();
    const lockSql = "hashtextextended('publication-channel:' || $1, 0)";
    try {
      const { rows } = await client.query<{ locked: boolean }>(
        `select pg_try_advisory_lock(${lockSql}) as locked`,
        [channelId],
      );
      if (!rows[0]?.locked) return { acquired: false };
      try {
        return { acquired: true, value: await fn() };
      } finally {
        await client.query(`select pg_advisory_unlock(${lockSql})`, [channelId]);
      }
    } finally {
      client.release();
    }
  }

  async loadContext(publicationId: string): Promise<PublicationContext | null> {
    const { rows } = await this.pool.query<ContextRow>(
      `select p.id, p.channel_id, p.status, p.idempotency_key, p.payload_json, p.reconcile_required,
              p.platform_checkpoint, c.platform, c.mode, c.paused, c.live_uploads_enabled,
              exists (select 1 from public.credential_refs cr
                       where cr.channel_id = c.id and cr.status = 'active'
                         and (cr.expires_at is null or cr.expires_at > now()))
                as credential_active,
              c.timezone, c.max_posts_per_day, c.min_minutes_between_posts,
              s.global_paused, p.render_id, r.qc_passed, r.disclosure_required,
              (select array_agg(src->>'assetId')
                 from jsonb_array_elements(coalesce(r.manifest->'sources', '[]'::jsonb)) src)
                as asset_ids,
              r.manifest->'voice'->>'id' as voice_id,
              (select array_agg(r.published_at order by r.published_at)
                 from public.publications r
                where r.channel_id = p.channel_id
                  and r.status = 'succeeded'
                  and r.published_at > now() - interval '48 hours') as recent_published_at
         from public.publications p
         join public.channels c on c.id = p.channel_id
         left join public.renders r on r.id = p.render_id
        cross join public.system_controls s
        where p.id = $1`,
      [publicationId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      publication: {
        id: row.id,
        channelId: row.channel_id,
        status: row.status,
        idempotencyKey: row.idempotency_key,
        payload: row.payload_json,
        reconcileRequired: row.reconcile_required,
        platformCheckpoint: row.platform_checkpoint,
      },
      channel: {
        platform: row.platform,
        mode: row.mode,
        paused: row.paused,
        liveUploadsEnabled: row.live_uploads_enabled,
        credentialActive: row.credential_active,
        timezone: row.timezone,
        maxPostsPerDay: row.max_posts_per_day,
        minMinutesBetweenPosts: row.min_minutes_between_posts,
      },
      systemPaused: row.global_paused,
      recentPublishedAt: row.recent_published_at ?? [],
      media: await this.loadMedia(row),
    };
  }

  /** Reads the render's assets and voice from the registry as they are NOW. */
  private async loadMedia(row: ContextRow): Promise<PublicationMedia | null> {
    if (row.render_id === null) return null;
    const assetIds = row.asset_ids ?? [];
    const { rows: assets } = await this.pool.query<{
      id: string;
      origin: AssetOrigin;
      rights_status: RightsStatus;
      license: LicenseJson | null;
    }>(
      `select a.id, a.origin, a.rights_status, ${LICENSE_JSON} as license
         from public.assets a left join public.licenses l on l.id = a.license_id
        where a.id::text = any($1)`,
      [assetIds],
    );
    const voice = row.voice_id
      ? (
          await this.pool.query<VoiceRow>(
            `select ${VOICE_COLUMNS}
               from public.voices v left join public.licenses l on l.id = v.license_id
              where v.id::text = $1`,
            [row.voice_id],
          )
        ).rows[0]
      : undefined;
    return {
      renderId: row.render_id,
      qcPassed: row.qc_passed === true,
      disclosureRequired: row.disclosure_required !== false,
      assets: assets.map((a) => ({
        id: a.id,
        origin: a.origin,
        rightsStatus: a.rights_status,
        license: toLicense(a.license),
      })),
      missingAssetIds: assetIds.filter((id) => !assets.some((a) => a.id === id)),
      voice: voice ? toVoiceRecord(voice) : null,
    };
  }

  async update(publicationId: string, update: PublicationUpdate): Promise<void> {
    const errorCode = "errorCode" in update ? (update.errorCode ?? null) : null;
    const nextAttemptAt = "nextAttemptAt" in update ? update.nextAttemptAt : null;
    const reconcileRequired = "reconcileRequired" in update;
    await this.pool.query(
      `update public.publications
          set status = $2::public.publication_status,
              error_code = $3,
              next_attempt_at = $4,
              reconcile_required = reconcile_required or $5
        where id = $1 and ${NOT_TERMINAL}`,
      [publicationId, update.status, errorCode, nextAttemptAt, reconcileRequired],
    );
  }

  async markSucceeded(
    publicationId: string,
    external: ExternalPublication,
    publishedAt: Date,
  ): Promise<void> {
    await this.pool.query(
      `update public.publications
          set status = 'succeeded', external_id = $2, permalink = $3, published_at = $4,
              error_code = null, next_attempt_at = null
        where id = $1 and ${NOT_TERMINAL}`,
      [publicationId, external.externalId, external.permalink, publishedAt],
    );
  }

  async recordAudit(event: WorkerAuditEvent): Promise<void> {
    await this.pool.query(
      `insert into public.audit_events (actor_type, action, object_type, object_id, safe_details)
       values ('worker', $1, 'publications', $2, $3)`,
      [event.action, event.publicationId, JSON.stringify(event.details)],
    );
  }

  async saveCheckpoint(publicationId: string, checkpoint: PlatformCheckpoint): Promise<void> {
    await this.pool.query(
      `update public.publications set platform_checkpoint = $2
        where id = $1 and ${NOT_TERMINAL}`,
      [publicationId, JSON.stringify(checkpoint)],
    );
  }
}
