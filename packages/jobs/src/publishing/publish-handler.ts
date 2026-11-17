import { DomainError } from "@gta6/domain";

import { publishSimulatedPayloadSchema, type QUEUES } from "../definitions";
import type { TrackedJobHandler } from "../job-runs";
import { processPublication, type ProcessPublicationDeps } from "./process-publication";

/**
 * Queue handler for `publish.simulated`. Throws only when the attempt must be retried by the
 * queue; every other outcome is recorded in job_runs and ends the job.
 */
export function createPublishHandler(
  deps: Omit<ProcessPublicationDeps, "logger">,
  queue: Pick<(typeof QUEUES)["publishSimulated"], "retryLimit">,
): TrackedJobHandler<unknown> {
  return async (job, { logger }) => {
    const payload = publishSimulatedPayloadSchema.safeParse(job.data);
    if (!payload.success) {
      return { status: "failed", errorCode: "VALIDATION_FAILED" };
    }
    const outcome = await processPublication(
      { ...deps, logger: logger.child({ publicationId: payload.data.publicationId }) },
      {
        publicationId: payload.data.publicationId,
        attempt: job.attempt,
        maxAttempts: queue.retryLimit + 1,
      },
    );
    switch (outcome.kind) {
      case "succeeded":
      case "skipped":
        return { status: "succeeded" };
      case "blocked":
        return { status: "blocked", errorCode: outcome.code };
      case "failed":
      case "needs_manual_reconciliation":
        return { status: "failed", errorCode: outcome.code };
      case "retry":
        throw outcome.error instanceof DomainError
          ? outcome.error
          : new DomainError("INTERNAL", "Retry requested");
    }
  };
}
