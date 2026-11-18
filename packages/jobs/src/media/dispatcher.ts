import type { Logger } from "@gta6/observability";
import type pg from "pg";

import { QUEUES } from "../definitions";
import type { JobQueue } from "../job-queue";
import { MAX_RENDER_CLAIMS, STALE_RENDERING_MINUTES } from "./render-project";

/**
 * Outbox dispatcher for `media_projects`: queued projects whose wait has passed and orphaned
 * rendering projects become `media.render` jobs (singletonKey = project id).
 */
export async function dispatchMediaRenders(pool: pg.Pool, queue: JobQueue): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `select id from public.media_projects
      where attempts < $2
        and ((status = 'queued' and coalesce(next_attempt_at, now()) <= now())
             or (status = 'rendering' and updated_at < now() - make_interval(mins => $1)))
      order by updated_at
      limit 5`,
    [STALE_RENDERING_MINUTES, MAX_RENDER_CLAIMS],
  );
  let enqueued = 0;
  for (const { id } of rows) {
    const jobId = await queue.enqueue(
      QUEUES.mediaRender.name,
      { projectId: id },
      { singletonKey: id },
    );
    if (jobId !== null) enqueued += 1;
  }
  return enqueued;
}

export interface RunningMediaDispatcher {
  stop(): Promise<void>;
}

export function startMediaDispatcher(
  pool: pg.Pool,
  queue: JobQueue,
  logger: Logger,
  intervalMs = 10_000,
): RunningMediaDispatcher {
  let running: Promise<void> | null = null;
  let stopped = false;
  const tick = () => {
    if (stopped || running) return;
    running = dispatchMediaRenders(pool, queue)
      .then((count) => {
        if (count > 0) logger.info({ count }, "media renders dispatched");
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, "media dispatch failed");
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
