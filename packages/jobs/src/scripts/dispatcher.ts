import type { Logger } from "@gta6/observability";
import type pg from "pg";

import { QUEUES } from "../definitions";
import type { JobQueue } from "../job-queue";
import { STALE_RUNNING_MINUTES } from "./draft-script";

/**
 * Outbox dispatcher for `script_requests`: queued rows, blocked rows whose wait has passed, and
 * orphaned running rows become `script.draft` jobs (singletonKey = request id).
 */
export async function dispatchScriptRequests(pool: pg.Pool, queue: JobQueue): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `select id from public.script_requests
      where status = 'queued'
         or (status = 'blocked' and coalesce(next_attempt_at, updated_at) <= now())
         or (status = 'running' and updated_at < now() - make_interval(mins => $1))
      order by created_at
      limit 20`,
    [STALE_RUNNING_MINUTES],
  );
  let enqueued = 0;
  for (const { id } of rows) {
    const jobId = await queue.enqueue(
      QUEUES.scriptDraft.name,
      { requestId: id },
      { singletonKey: id },
    );
    if (jobId !== null) enqueued += 1;
  }
  return enqueued;
}

export interface RunningScriptDispatcher {
  stop(): Promise<void>;
}

export function startScriptDispatcher(
  pool: pg.Pool,
  queue: JobQueue,
  logger: Logger,
  intervalMs = 10_000,
): RunningScriptDispatcher {
  let running: Promise<void> | null = null;
  let stopped = false;
  const tick = () => {
    if (stopped || running) return;
    running = dispatchScriptRequests(pool, queue)
      .then((count) => {
        if (count > 0) logger.info({ count }, "script requests dispatched");
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, "script dispatch failed");
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
