import { DomainError, isDomainError } from "@gta6/domain";
import type { TypedSupabaseClient } from "@gta6/db";
import type { Logger } from "@gta6/observability";

import type { JobHandler, QueuedJob } from "./job-queue";

export interface JobRunContext {
  readonly logger: Logger;
  readonly jobRunId: string | null;
}

export type TrackedJobHandler<T> = (job: QueuedJob<T>, context: JobRunContext) => Promise<void>;

export interface TrackOptions {
  readonly targetType?: string;
  readonly targetId?: (data: unknown) => string | undefined;
}

/**
 * Wraps a handler so every attempt is recorded in `job_runs` (business view for the console)
 * and logged with the job id. Errors are recorded by code only and re-thrown so the queue
 * applies its retry policy.
 */
export function trackJobRuns<T>(
  db: TypedSupabaseClient,
  baseLogger: Logger,
  handler: TrackedJobHandler<T>,
  options: TrackOptions = {},
): JobHandler<T> {
  return async (job) => {
    const logger = baseLogger.child({ jobId: job.id, queue: job.queue, attempt: job.attempt });
    const targetId = options.targetId?.(job.data);

    const { data: run, error: insertError } = await db
      .from("job_runs")
      .insert({
        job_name: job.queue,
        queue_job_id: job.id,
        attempt: job.attempt,
        status: "running",
        started_at: new Date().toISOString(),
        ...(options.targetType === undefined ? {} : { target_type: options.targetType }),
        ...(targetId === undefined ? {} : { target_id: targetId }),
      })
      .select("id")
      .single();
    if (insertError) {
      logger.error({ dbErrorCode: insertError.code }, "could not record job run");
    }
    const jobRunId = run?.id ?? null;

    const finish = async (status: "succeeded" | "failed" | "blocked", errorCode?: string) => {
      if (!jobRunId) return;
      const { error } = await db
        .from("job_runs")
        .update({
          status,
          finished_at: new Date().toISOString(),
          ...(errorCode === undefined ? {} : { error_code: errorCode }),
        })
        .eq("id", jobRunId);
      if (error) logger.error({ dbErrorCode: error.code }, "could not finish job run");
    };

    logger.info("job started");
    try {
      await handler(job, { logger, jobRunId });
      await finish("succeeded");
      logger.info("job succeeded");
    } catch (error) {
      const code = isDomainError(error) ? error.code : "INTERNAL";
      const blocked = code === "SYSTEM_PAUSED" || code === "CHANNEL_PAUSED";
      await finish(blocked ? "blocked" : "failed", code);
      logger.warn({ errorCode: code, err: error }, "job failed");
      throw error instanceof Error ? error : new DomainError("INTERNAL", "Job failed");
    }
  };
}
