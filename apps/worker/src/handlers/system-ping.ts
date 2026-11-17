import { DomainError } from "@gta6/domain";
import { systemPingPayloadSchema, type TrackedJobHandler } from "@gta6/jobs";

/** Diagnostic job: proves the queue → worker → job_runs path end to end. Does nothing else. */
export const handleSystemPing: TrackedJobHandler<unknown> = (job, { logger }) => {
  const payload = systemPingPayloadSchema.safeParse(job.data);
  if (!payload.success) {
    return Promise.reject(new DomainError("VALIDATION_FAILED", "Invalid system.ping payload"));
  }
  const latencyMs = Date.now() - Date.parse(payload.data.requestedAt);
  logger.info({ latencyMs }, "pong");
  return Promise.resolve();
};
