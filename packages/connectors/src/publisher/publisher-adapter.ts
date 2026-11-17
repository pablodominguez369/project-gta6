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
  scheduledAt: z.iso.datetime().nullable(),
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
  publish(request: PublishRequest): Promise<Result<ExternalPublication, DomainError>>;
  /** Looks for an earlier upload of this request. Used after timeouts and before retries. */
  reconcile(request: PublishRequest): Promise<Result<ReconcileResult, DomainError>>;
  getStatus(externalId: string): Promise<Result<ExternalPublication, DomainError>>;
}
