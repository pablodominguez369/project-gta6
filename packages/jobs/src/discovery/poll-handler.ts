import { FeedDiscoveryProvider } from "@gta6/connectors";
import type pg from "pg";

import { QUEUES } from "../definitions";
import type { JobQueue } from "../job-queue";
import type { TrackedJobHandler } from "../job-runs";
import { PgDiscoveryStore } from "./discovery-store";
import { pollFeeds } from "./poll-feeds";

/** Queue handler for `discovery.poll`: reads every due allowlisted feed. */
export function createDiscoveryPollHandler(
  pool: pg.Pool,
  queue: JobQueue,
): TrackedJobHandler<unknown> {
  const store = new PgDiscoveryStore(pool);
  return async (_job, { logger }) => {
    const outcome = await pollFeeds({
      store,
      logger,
      providerFor: (feed) =>
        new FeedDiscoveryProvider({
          feedUrl: feed.url,
          publisher: feed.publisher,
          termsUrl: feed.termsUrl,
        }),
    });
    if (outcome.kind === "paused") return { status: "blocked", errorCode: "SYSTEM_PAUSED" };
    logger.info(outcome, "discovery poll finished");
    if (outcome.newSources > 0) {
      await queue.enqueue(
        QUEUES.opportunityBuild.name,
        { requestedAt: new Date().toISOString() },
        { singletonKey: "opportunity.build" },
      );
    }
    return { status: "succeeded" };
  };
}

export interface RunningSchedule {
  stop(): void;
}

/**
 * Enqueues `discovery.poll` and `opportunity.build` every `intervalMs` (the build also picks up
 * sources added by hand). Exclusive queues drop overlapping runs.
 */
export function scheduleDiscoveryPoll(queue: JobQueue, intervalMs = 5 * 60_000): RunningSchedule {
  const enqueue = () => {
    const data = { requestedAt: new Date().toISOString() };
    return Promise.all([
      queue.enqueue(QUEUES.discoveryPoll.name, data, { singletonKey: "discovery.poll" }),
      queue.enqueue(QUEUES.opportunityBuild.name, data, { singletonKey: "opportunity.build" }),
    ]).catch(() => null);
  };
  void enqueue();
  const timer = setInterval(() => void enqueue(), intervalMs);
  return {
    stop() {
      clearInterval(timer);
    },
  };
}
