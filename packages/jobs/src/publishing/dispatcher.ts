import type { Logger } from "@gta6/observability";
import type pg from "pg";

import { QUEUES } from "../definitions";
import type { JobQueue } from "../job-queue";

export interface DispatchOptions {
  /** An in_progress publication untouched for this long is assumed orphaned (worker crash). */
  readonly staleInProgressSeconds?: number;
  readonly batchSize?: number;
}

/**
 * Outbox dispatcher: turns due rows in `publications` into `publish.simulated` jobs.
 * The web app only inserts rows; it never talks to the queue. Safe to run concurrently and
 * repeatedly: the queue is "exclusive" with singletonKey = publication id, so a publication never
 * has two queued-or-active jobs, and the orchestrator re-checks everything under a channel lock.
 *
 * Picked up:
 * - queued, once scheduled_at (if any) has passed;
 * - blocked, once next_attempt_at has passed and neither the system nor the channel is paused;
 * - in_progress rows that look orphaned (they reconcile first, so this cannot duplicate).
 * Ambiguous rows are NOT picked up: after all automatic attempts they need an operator.
 */
export async function dispatchDuePublications(
  pool: pg.Pool,
  queue: JobQueue,
  options: DispatchOptions = {},
): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `select p.id
       from public.publications p
       join public.channels c on c.id = p.channel_id
      cross join public.system_controls s
      where (p.status = 'queued' and (p.scheduled_at is null or p.scheduled_at <= now()))
         or (p.status = 'blocked'
             and coalesce(p.next_attempt_at, p.updated_at) <= now()
             and not s.global_paused and not c.paused)
         or (p.status = 'in_progress'
             and p.updated_at < now() - make_interval(secs => $1))
      order by p.created_at
      limit $2`,
    [options.staleInProgressSeconds ?? 900, options.batchSize ?? 50],
  );

  let enqueued = 0;
  for (const { id } of rows) {
    const jobId = await queue.enqueue(
      QUEUES.publishSimulated.name,
      { publicationId: id },
      { singletonKey: id },
    );
    if (jobId !== null) enqueued += 1;
  }
  return enqueued;
}

export interface RunningDispatcher {
  stop(): Promise<void>;
}

/** Runs the dispatcher every `intervalMs`, never overlapping two runs. */
export function startDispatcher(
  pool: pg.Pool,
  queue: JobQueue,
  logger: Logger,
  intervalMs = 5_000,
): RunningDispatcher {
  let running: Promise<void> | null = null;
  let stopped = false;

  const tick = () => {
    if (stopped || running) return;
    running = dispatchDuePublications(pool, queue)
      .then((count) => {
        if (count > 0) logger.info({ count }, "publications dispatched");
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, "dispatch failed");
      })
      .finally(() => {
        running = null;
      });
  };
  const timer = setInterval(tick, intervalMs);
  tick();

  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}
