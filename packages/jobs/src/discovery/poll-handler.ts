import { FeedDiscoveryProvider } from "@gta6/connectors";
import type pg from "pg";

import { QUEUES } from "../definitions";
import type { JobQueue } from "../job-queue";
import type { TrackedJobHandler } from "../job-runs";
import { PgDiscoveryStore } from "./discovery-store";
import { pollFeeds } from "./poll-feeds";

/** Queue handler for `discovery.poll`: reads every due allowlisted feed. */
export function createDiscoveryPollHandler(pool: pg.Pool): TrackedJobHandler<unknown> {
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
    return { status: "succeeded" };
  };
}

export interface RunningSchedule {
  stop(): void;
}

/** Enqueues one `discovery.poll` every `intervalMs`; the exclusive queue drops overlapping runs. */
export function scheduleDiscoveryPoll(queue: JobQueue, intervalMs = 5 * 60_000): RunningSchedule {
  const enqueue = () =>
    queue
      .enqueue(
        QUEUES.discoveryPoll.name,
        { requestedAt: new Date().toISOString() },
        { singletonKey: "discovery.poll" },
      )
      .catch(() => null);
  void enqueue();
  const timer = setInterval(() => void enqueue(), intervalMs);
  return {
    stop() {
      clearInterval(timer);
    },
  };
}
