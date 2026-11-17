import { z } from "zod";

import type { QueueDefinition } from "./job-queue";

/**
 * Every queue and its payload schema. Payloads carry ids only: the handler loads current state
 * from the database, so a retried job never acts on stale data and never carries secrets.
 */
export const QUEUES = {
  publishSimulated: {
    name: "publish.simulated",
    // One queued-or-active job per publication (singletonKey = publication id).
    policy: "exclusive",
    // Retries only for transient errors; ambiguous outcomes are reconciled, never blindly retried.
    retryLimit: 3,
    retryDelaySeconds: 10,
    expireInSeconds: 300,
  },
  discoveryPoll: {
    name: "discovery.poll",
    // One poll run at a time; the next scheduled run retries failed feeds.
    policy: "exclusive",
    retryLimit: 0,
    retryDelaySeconds: 60,
    expireInSeconds: 600,
  },
  systemPing: {
    name: "system.ping",
    policy: "standard",
    retryLimit: 1,
    retryDelaySeconds: 5,
    expireInSeconds: 60,
  },
} as const satisfies Record<string, QueueDefinition>;

export const publishSimulatedPayloadSchema = z.object({
  publicationId: z.uuid(),
});
export type PublishSimulatedPayload = z.infer<typeof publishSimulatedPayloadSchema>;

export const systemPingPayloadSchema = z.object({
  requestedAt: z.iso.datetime(),
});
export type SystemPingPayload = z.infer<typeof systemPingPayloadSchema>;

export const discoveryPollPayloadSchema = z.object({
  requestedAt: z.iso.datetime(),
});
export type DiscoveryPollPayload = z.infer<typeof discoveryPollPayloadSchema>;
