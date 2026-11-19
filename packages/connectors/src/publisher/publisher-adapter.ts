import type { DomainError, Platform, Result } from "@gta6/domain";
import { z } from "zod";

/**
 * What an adapter can do, as CONFIRMED against the platform's official documentation.
 * Anything not confirmed stays false; the orchestrator then falls back to a manual package.
 */
export interface PublisherCapabilities {
  readonly directPublish: boolean;
  readonly scheduledPublish: boolean;
  /** Can find a previous upload of the same request (needed to reconcile ambiguous results). */
  readonly reconcileByRequest: boolean;
  /** Can upload without making the post public (YouTube private, TikTok SELF_ONLY). */
  readonly privateVisibility: boolean;
  /** ISO date when the capabilities were last checked against official docs; null = never. */
  readonly verifiedAgainstDocsAt: string | null;
  readonly docsUrls: readonly string[];
}

export const publishRequestSchema = z.object({
  /** Stable per intended post. Sent to the platform where supported, and used to reconcile. */
  idempotencyKey: z.string().min(8).max(200),
  channelId: z.uuid(),
  title: z.string().min(1).max(100),
  description: z.string().max(5_000),
  /** Reference to the rendered media in our storage (never a signed URL). */
  mediaRef: z.string().min(1),
  /** The video contains synthetic media (AI voice); adapters set the platform's AI label. */
  syntheticMedia: z.boolean(),
  scheduledAt: z.iso.datetime().nullable(),
  /** Private by default; "public" only reaches an adapter once every gate passed (ADR 0007). */
  visibility: z.enum(["private", "public"]),
  /** A person chose the visibility for this post when queuing it (required by TikTok). */
  visibilityConfirmed: z.boolean(),
});

export type PublishRequest = z.infer<typeof publishRequestSchema>;

export type ExternalStatus = "published" | "processing" | "scheduled" | "rejected";

export interface ExternalPublication {
  readonly externalId: string;
  readonly permalink: string | null;
  readonly status: ExternalStatus;
}

export type ReconcileResult =
  { readonly found: true; readonly publication: ExternalPublication } | { readonly found: false };

/**
 * Ids an adapter saves before a step whose outcome could be lost (an upload session, a publish
 * id, a container id). Stored in `publications.platform_checkpoint`; never tokens or signed URLs.
 */
export type PlatformCheckpoint = Readonly<Record<string, string | number | boolean | null>>;

export interface PublishContext {
  /** Checkpoint saved by an earlier attempt of the same publication, if any. */
  readonly checkpoint: PlatformCheckpoint | null;
  /** Persists the checkpoint BEFORE the adapter continues (it must survive a crash). */
  saveCheckpoint(checkpoint: PlatformCheckpoint): Promise<void>;
}

/** A context that keeps the checkpoint in memory, for the simulator and tests. */
export function memoryPublishContext(
  initial: PlatformCheckpoint | null = null,
): PublishContext & { readonly current: () => PlatformCheckpoint | null } {
  let checkpoint = initial;
  return {
    get checkpoint() {
      return checkpoint;
    },
    current: () => checkpoint,
    saveCheckpoint(next) {
      checkpoint = next;
      return Promise.resolve();
    },
  };
}

/**
 * Error codes an adapter may return. The orchestrator decides what to do with each:
 * - RATE_LIMITED, EXTERNAL_UNAVAILABLE: retry later (retryable).
 * - AMBIGUOUS_EXTERNAL_STATE: the request may or may not have been accepted. Reconcile first.
 * - CREDENTIAL_EXPIRED, VALIDATION_FAILED, FORBIDDEN: stop and ask an operator.
 * - NOT_FOUND: getStatus for an unknown external id.
 */
export type PublisherErrorCode = Extract<
  DomainError["code"],
  | "RATE_LIMITED"
  | "EXTERNAL_UNAVAILABLE"
  | "AMBIGUOUS_EXTERNAL_STATE"
  | "CREDENTIAL_EXPIRED"
  | "VALIDATION_FAILED"
  | "FORBIDDEN"
  | "NOT_FOUND"
>;

/**
 * One adapter per platform. Adapters never throw for expected failures: they return a Result
 * with a DomainError whose code is a PublisherErrorCode. They are not required to be idempotent;
 * the orchestrator guarantees no duplicates by reconciling before any retry.
 */
export interface PublisherAdapter {
  readonly platform: Platform;
  readonly capabilities: PublisherCapabilities;
  validate(request: PublishRequest): Result<PublishRequest, DomainError>;
  publish(
    request: PublishRequest,
    context?: PublishContext,
  ): Promise<Result<ExternalPublication, DomainError>>;
  /**
   * Looks for an earlier upload of this request. Used after timeouts and before retries.
   * `checkpoint` is what earlier attempts saved; adapters without an idempotency key use it.
   */
  reconcile(
    request: PublishRequest,
    checkpoint?: PlatformCheckpoint | null,
  ): Promise<Result<ReconcileResult, DomainError>>;
  /** `channelId` selects the account's credential on real platforms. */
  getStatus(
    externalId: string,
    channelId?: string,
  ): Promise<Result<ExternalPublication, DomainError>>;
}
