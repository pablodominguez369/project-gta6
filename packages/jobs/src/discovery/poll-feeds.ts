import type { DiscoveryProvider } from "@gta6/connectors";
import type { Logger } from "@gta6/observability";

import type { DiscoveryStore, DueFeed } from "./discovery-store";

export interface PollFeedsDeps {
  readonly store: DiscoveryStore;
  readonly providerFor: (feed: DueFeed) => DiscoveryProvider;
  readonly logger: Logger;
  readonly now?: () => Date;
  /** Consecutive failures before a feed is disabled and an admin must look at it. */
  readonly disableAfter?: number;
}

export type PollOutcome =
  | { readonly kind: "paused" }
  | {
      readonly kind: "polled";
      readonly feeds: number;
      readonly newSources: number;
      readonly failures: number;
      readonly disabled: number;
    };

/** First poll of a new feed only looks this far back. */
export const INITIAL_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_DISABLE_AFTER = 5;

/**
 * Polls every due, allowlisted feed once. A failing feed never stops the others; after
 * `disableAfter` failures in a row it is disabled (never retried harder: rule 3 and rule 8).
 * Nothing runs while the global pause is on.
 */
export async function pollFeeds(deps: PollFeedsDeps): Promise<PollOutcome> {
  const { store, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const disableAfter = deps.disableAfter ?? DEFAULT_DISABLE_AFTER;

  if (await store.isSystemPaused()) {
    logger.info("global pause active; discovery skipped");
    return { kind: "paused" };
  }

  const feeds = await store.dueFeeds();
  let newSources = 0;
  let failures = 0;
  let disabled = 0;

  for (const feed of feeds) {
    const feedLogger = logger.child({ feedId: feed.id });
    const startedAt = now();
    const since = feed.lastPolledAt ?? new Date(startedAt.getTime() - INITIAL_LOOKBACK_MS);
    const result = await deps.providerFor(feed).fetchSince(since);
    if (!result.ok) {
      failures += 1;
      const wasDisabled = await store.recordFailure(feed.id, result.error.code, disableAfter);
      if (wasDisabled) disabled += 1;
      feedLogger.warn({ errorCode: result.error.code, disabled: wasDisabled }, "feed poll failed");
      continue;
    }
    const inserted = await store.saveItems(feed, result.value);
    await store.recordSuccess(feed.id, startedAt);
    newSources += inserted;
    feedLogger.info({ items: result.value.length, inserted }, "feed polled");
  }

  return { kind: "polled", feeds: feeds.length, newSources, failures, disabled };
}
