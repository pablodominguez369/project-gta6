import {
  assessOpportunity,
  CLUSTER_WINDOW_HOURS,
  findCluster,
  type EvidenceSource,
  type SourceType,
} from "@gta6/domain";
import type { Logger } from "@gta6/observability";
import type pg from "pg";

export interface BuildOutcome {
  readonly linkedSources: number;
  readonly createdOpportunities: number;
  readonly assessed: number;
  readonly discardedAsLeak: number;
  readonly expired: number;
}

interface SourceRow {
  id: string;
  title: string;
}

interface EvidenceRow {
  publisher: string;
  source_type: SourceType;
  trust_level: number;
  title: string;
  excerpt: string | null;
  published_at: Date | null;
  observed_at: Date;
}

/**
 * Groups new sources into opportunities (same story within 72 h), then re-assesses every touched
 * opportunity: certainty, score, risk flags and expiry. Editors' decisions are never overridden;
 * only a "new" opportunity can be discarded automatically (possible leak). Runs in one
 * transaction so a failure leaves nothing half-linked.
 */
export async function buildOpportunities(
  pool: pg.Pool,
  logger: Logger,
  now: Date = new Date(),
): Promise<BuildOutcome> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const window = `${String(CLUSTER_WINDOW_HOURS)} hours`;

    const { rows: unlinked } = await client.query<SourceRow>(
      `select s.id, s.title
         from public.sources s
        where s.observed_at > $1::timestamptz - $2::interval
          and not exists (select 1 from public.opportunity_sources o where o.source_id = s.id)
        order by s.observed_at, s.id
        limit 200`,
      [now, window],
    );

    const { rows: open } = await client.query<{ id: string; titles: string[] }>(
      `select o.id, array_agg(s.title order by s.observed_at) as titles
         from public.opportunities o
         join public.opportunity_sources os on os.opportunity_id = o.id
         join public.sources s on s.id = os.source_id
        where o.status in ('new', 'shortlisted', 'accepted')
          and o.created_at > $1::timestamptz - $2::interval
        group by o.id`,
      [now, window],
    );
    const candidates: { opportunityId: string; titles: string[] }[] = open.map((row) => ({
      opportunityId: row.id,
      titles: row.titles,
    }));

    const touched = new Set<string>();
    let created = 0;
    for (const source of unlinked) {
      let opportunityId = findCluster(source.title, candidates);
      if (opportunityId === null) {
        const { rows } = await client.query<{ id: string }>(
          `insert into public.opportunities (topic) values ($1) returning id`,
          [source.title.slice(0, 200)],
        );
        const id = rows[0]?.id;
        if (!id) throw new Error("opportunity insert returned no id");
        opportunityId = id;
        candidates.push({ opportunityId: id, titles: [] });
        created += 1;
      }
      await client.query(
        `insert into public.opportunity_sources (opportunity_id, source_id) values ($1, $2)
         on conflict do nothing`,
        [opportunityId, source.id],
      );
      candidates.find((c) => c.opportunityId === opportunityId)?.titles.push(source.title);
      touched.add(opportunityId);
    }

    let discardedAsLeak = 0;
    for (const opportunityId of touched) {
      const { rows } = await client.query<EvidenceRow>(
        `select s.publisher, s.source_type, s.trust_level, s.title, s.excerpt, s.published_at,
                s.observed_at
           from public.opportunity_sources os
           join public.sources s on s.id = os.source_id
          where os.opportunity_id = $1`,
        [opportunityId],
      );
      const evidence: EvidenceSource[] = rows.map((row) => ({
        publisher: row.publisher,
        sourceType: row.source_type,
        trustLevel: row.trust_level,
        title: row.title,
        excerpt: row.excerpt,
        publishedAt: row.published_at,
        observedAt: row.observed_at,
      }));
      const assessment = assessOpportunity(evidence, now);
      const { rows: updated } = await client.query<{ status: string }>(
        `update public.opportunities
            set certainty = $2, score = $3, risk_flags = $4, expires_at = $5,
                status = case when status = 'new' and $6::text is not null
                              then 'discarded'::public.opportunity_status else status end,
                decision_reason = case when status = 'new' and $6::text is not null
                                       then $6 else decision_reason end
          where id = $1
          returning status`,
        [
          opportunityId,
          assessment.certainty,
          assessment.score,
          assessment.riskFlags,
          assessment.expiresAt,
          assessment.discardReason,
        ],
      );
      if (assessment.discardReason !== null && updated[0]?.status === "discarded") {
        discardedAsLeak += 1;
      }
    }

    const { rowCount: expired } = await client.query(
      `update public.opportunities set status = 'expired'
        where status in ('new', 'shortlisted') and expires_at is not null and expires_at < $1`,
      [now],
    );

    await client.query("commit");
    const outcome = {
      linkedSources: unlinked.length,
      createdOpportunities: created,
      assessed: touched.size,
      discardedAsLeak,
      expired: expired ?? 0,
    };
    logger.info(outcome, "opportunities built");
    return outcome;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
