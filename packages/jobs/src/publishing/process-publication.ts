import type { PublisherAdapter, PublishContext, PublishRequest } from "@gta6/connectors";
import {
  checkFrequency,
  DomainError,
  evaluatePublicationMedia,
  evaluatePublishGates,
  isTerminal,
  publicationPayloadSchema,
  type ErrorCode,
  type Platform,
  type PublishingMode,
} from "@gta6/domain";
import type { Logger } from "@gta6/observability";

import type { PublicationContext, PublicationStore } from "./publication-store";

export interface ProcessPublicationDeps {
  readonly store: PublicationStore;
  /** One adapter per platform. A platform without an adapter is refused (FORBIDDEN). */
  readonly publishers: Partial<Record<Platform, PublisherAdapter>>;
  /** Worker setting; real platforms are refused unless "live" (ADR 0005). */
  readonly publishingMode: PublishingMode;
  readonly logger: Logger;
  readonly now?: () => Date;
}

export interface ProcessPublicationInput {
  readonly publicationId: string;
  /** 1 for the first attempt. */
  readonly attempt: number;
  /** Total attempts the queue allows (retryLimit + 1). On the last one nothing is retried. */
  readonly maxAttempts: number;
}

export type PublicationOutcome =
  | { readonly kind: "succeeded"; readonly via: "publish" | "reconcile" }
  | { readonly kind: "skipped"; readonly reason: "not_found" | "terminal" | "awaiting_manual" }
  /** Manual channel: gates passed and the package waits for a person to upload it. */
  | { readonly kind: "manual_ready" }
  /** Stopped by a pause or a frequency limit; the dispatcher picks it up again later. */
  | { readonly kind: "blocked"; readonly code: ErrorCode }
  | { readonly kind: "failed"; readonly code: ErrorCode }
  /** Outcome unknown and no attempts left: an operator must reconcile (runbook). */
  | { readonly kind: "needs_manual_reconciliation"; readonly code: ErrorCode }
  /** Transient problem: the caller must throw so the queue retries the job. */
  | { readonly kind: "retry"; readonly error: DomainError };

/** Delay before the dispatcher re-checks a publication blocked by a pause. */
export const PAUSE_RECHECK_MS = 60_000;
/** Delay before the dispatcher re-checks a publication blocked by a frequency limit. */
export const RATE_LIMIT_RECHECK_MS = 15 * 60_000;

/** Publisher errors that mean "try again later"; nothing was accepted by the platform. */
const TRANSIENT_CODES = new Set<ErrorCode>(["RATE_LIMITED", "EXTERNAL_UNAVAILABLE"]);

/**
 * One attempt to publish one publication. Safe to run any number of times for the same id:
 *
 * 1. Gates (global pause, channel pause, simulated-only platform) are checked on EVERY attempt.
 * 2. Before calling the platform, `reconcile_required` is committed. From then on, every attempt
 *    first asks the platform whether the post already exists (rule 7), so a timeout after the
 *    platform accepted the post can never create a duplicate.
 * 3. Ambiguous results are retried only through reconciliation; with no attempts left the
 *    publication stays `ambiguous` and an audit event asks for manual reconciliation.
 */
export async function processPublication(
  deps: ProcessPublicationDeps,
  input: ProcessPublicationInput,
): Promise<PublicationOutcome> {
  const channelId = await deps.store.findChannelId(input.publicationId);
  if (channelId === null) return { kind: "skipped", reason: "not_found" };

  const locked = await deps.store.withChannelLock(channelId, () => attempt(deps, input));
  if (!locked.acquired) {
    // Another attempt for this channel is running. Retry later instead of interleaving.
    return {
      kind: "retry",
      error: new DomainError("CONFLICT", "Channel is busy with another publication"),
    };
  }
  return locked.value;
}

async function attempt(
  deps: ProcessPublicationDeps,
  input: ProcessPublicationInput,
): Promise<PublicationOutcome> {
  const { store, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const id = input.publicationId;
  const finalAttempt = input.attempt >= input.maxAttempts;

  const context = await store.loadContext(id);
  if (!context) return { kind: "skipped", reason: "not_found" };
  if (isTerminal(context.publication.status)) return { kind: "skipped", reason: "terminal" };
  if (context.publication.status === "awaiting_manual") {
    return { kind: "skipped", reason: "awaiting_manual" };
  }

  const gates = evaluatePublishGates({
    systemPaused: context.systemPaused,
    channelPaused: context.channel.paused,
    platform: context.channel.platform,
    publishingMode: deps.publishingMode,
    liveUploadsEnabled: context.channel.liveUploadsEnabled,
    channelMode: context.channel.mode,
    credentialActive: context.channel.credentialActive,
  });
  if (!gates.ok) {
    const code = gates.error.code;
    // Not a pause: an operator must act (enable the channel, reconnect the account).
    if (code === "FORBIDDEN" || code === "CREDENTIAL_EXPIRED") {
      await store.update(id, { status: "failed", errorCode: code });
      return { kind: "failed", code };
    }
    await block(store, id, code, now());
    return { kind: "blocked", code };
  }

  // Manual channels never call a platform: they pass the same gates and wait for a person.
  const manual = context.channel.mode === "manual";
  const publisher = manual ? null : deps.publishers[context.channel.platform];
  // Phase 4 only uploads privately; an adapter that cannot (Instagram) is never called.
  if (
    !manual &&
    (publisher?.platform !== context.channel.platform || !publisher.capabilities.privateVisibility)
  ) {
    await store.update(id, { status: "failed", errorCode: "FORBIDDEN" });
    await store.recordAudit({
      action: "publications.platform_refused",
      publicationId: id,
      details: { platform: context.channel.platform, hasAdapter: Boolean(publisher) },
    });
    return { kind: "failed", code: "FORBIDDEN" };
  }

  const request = buildRequest(context);
  if (!request) {
    await store.update(id, { status: "failed", errorCode: "VALIDATION_FAILED" });
    return { kind: "failed", code: "VALIDATION_FAILED" };
  }

  let checkpoint = context.publication.platformCheckpoint;
  const publishContext: PublishContext = {
    get checkpoint() {
      return checkpoint;
    },
    async saveCheckpoint(next) {
      await store.saveCheckpoint(id, next);
      checkpoint = next;
    },
  };

  await store.update(id, { status: "in_progress" });

  if (publisher && context.publication.reconcileRequired) {
    const reconciled = await publisher.reconcile(request, checkpoint);
    if (!reconciled.ok) {
      logger.warn({ errorCode: reconciled.error.code }, "reconciliation failed");
      return ambiguous(deps, id, "AMBIGUOUS_EXTERNAL_STATE", finalAttempt, "reconcile_failed");
    }
    if (reconciled.value.found) {
      await store.markSucceeded(id, reconciled.value.publication, now());
      await store.recordAudit({
        action: "publications.reconciled",
        publicationId: id,
        details: { externalId: reconciled.value.publication.externalId, attempt: input.attempt },
      });
      logger.info("publication found on platform; no new post created");
      return { kind: "succeeded", via: "reconcile" };
    }
    logger.info("reconciliation: not on platform, publishing");
  }

  // Rights, QC, voice and disclosure of the video, re-checked before every new
  // publish (rules 3 and 5). After reconciliation, so a post that already exists is never hidden.
  const media = evaluatePublicationMedia({
    platform: context.channel.platform,
    media: context.media,
    declaresSyntheticMedia: request.syntheticMedia,
    at: now(),
  });
  if (!media.ok) {
    await store.update(id, { status: "failed", errorCode: "RIGHTS_BLOCKED" });
    await store.recordAudit({
      action: "publications.rights_blocked",
      publicationId: id,
      details: { issues: media.issues.join(","), renderId: context.media?.renderId ?? null },
    });
    logger.warn({ issues: media.issues }, "publication blocked by the media gate");
    return { kind: "failed", code: "RIGHTS_BLOCKED" };
  }

  const frequency = checkFrequency({
    now: now(),
    timezone: context.channel.timezone,
    maxPostsPerDay: context.channel.maxPostsPerDay,
    minMinutesBetweenPosts: context.channel.minMinutesBetweenPosts,
    recentPublishedAt: context.recentPublishedAt,
  });
  if (!frequency.ok) {
    await block(store, id, frequency.error.code, now());
    return { kind: "blocked", code: frequency.error.code };
  }

  if (manual || !publisher) {
    // Same gates as an automatic upload, then a person takes over (T30). Nothing is sent.
    await store.update(id, { status: "awaiting_manual" });
    await store.recordAudit({
      action: "publications.manual_package_ready",
      publicationId: id,
      details: { platform: context.channel.platform },
    });
    return { kind: "manual_ready" };
  }

  // Committed BEFORE the call: if the process dies mid-request, the next attempt reconciles.
  await store.update(id, { status: "in_progress", reconcileRequired: true });
  const published = await publisher.publish(request, publishContext);

  if (published.ok) {
    await store.markSucceeded(id, published.value, now());
    return { kind: "succeeded", via: "publish" };
  }

  const code = published.error.code;
  if (code === "AMBIGUOUS_EXTERNAL_STATE") {
    return ambiguous(deps, id, code, finalAttempt, "publish_timeout");
  }
  if (TRANSIENT_CODES.has(code)) {
    if (finalAttempt) {
      await store.update(id, { status: "failed", errorCode: code });
      return { kind: "failed", code };
    }
    await store.update(id, { status: "in_progress", errorCode: code });
    return { kind: "retry", error: published.error };
  }
  // CREDENTIAL_EXPIRED, VALIDATION_FAILED, FORBIDDEN...: an operator must act; never retried.
  await store.update(id, { status: "failed", errorCode: code });
  return { kind: "failed", code };
}

function buildRequest(context: PublicationContext): PublishRequest | null {
  const payload = publicationPayloadSchema.safeParse(context.publication.payload);
  if (!payload.success) return null;
  return {
    idempotencyKey: context.publication.idempotencyKey,
    channelId: context.publication.channelId,
    title: payload.data.title,
    description: payload.data.description,
    mediaRef: payload.data.mediaRef,
    syntheticMedia: payload.data.syntheticMedia,
    // The dispatcher only enqueues once scheduled_at has passed, so the post goes out now.
    scheduledAt: null,
    visibility: "private",
  };
}

async function block(
  store: PublicationStore,
  id: string,
  code: ErrorCode,
  now: Date,
): Promise<void> {
  const delay = code === "RATE_LIMITED" ? RATE_LIMIT_RECHECK_MS : PAUSE_RECHECK_MS;
  await store.update(id, {
    status: "blocked",
    errorCode: code,
    nextAttemptAt: new Date(now.getTime() + delay),
  });
}

async function ambiguous(
  deps: ProcessPublicationDeps,
  id: string,
  code: ErrorCode,
  finalAttempt: boolean,
  cause: "publish_timeout" | "reconcile_failed",
): Promise<PublicationOutcome> {
  await deps.store.update(id, { status: "ambiguous", errorCode: code });
  if (!finalAttempt) {
    // The retry starts with reconciliation because reconcile_required is already true.
    return { kind: "retry", error: new DomainError("AMBIGUOUS_EXTERNAL_STATE", "Will reconcile") };
  }
  await deps.store.recordAudit({
    action: "publications.reconciliation_required",
    publicationId: id,
    details: { cause, runbook: "docs/runbooks/ambiguous-publication.md" },
  });
  deps.logger.error({ cause }, "publication ambiguous after all attempts; manual reconciliation");
  return { kind: "needs_manual_reconciliation", code };
}
