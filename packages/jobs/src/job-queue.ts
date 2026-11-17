/**
 * Provider-agnostic job queue. pg-boss implements it today; Temporal, BullMQ or Supabase Queues
 * can replace it without touching job handlers (ADR 0002).
 */

export interface QueueDefinition {
  readonly name: string;
  /**
   * "standard": no deduplication. "exclusive": at most one queued-or-active job per
   * `singletonKey` (a second enqueue with the same key returns null). Fixed at creation.
   */
  readonly policy: "standard" | "exclusive";
  /** Attempts after the first one. 0 disables automatic retries. */
  readonly retryLimit: number;
  /** Initial delay between retries, in seconds. Doubles on each retry (exponential backoff). */
  readonly retryDelaySeconds: number;
  /** A running job is considered dead after this many seconds and becomes eligible again. */
  readonly expireInSeconds: number;
}

export interface EnqueueOptions {
  /**
   * Deduplication key for "exclusive" queues: while a job with the same key is queued or active,
   * enqueueing again is a no-op and returns null.
   */
  readonly singletonKey?: string;
  readonly startAfter?: Date;
}

export interface QueuedJob<T> {
  readonly id: string;
  readonly queue: string;
  readonly data: T;
  /** 1 for the first attempt, 2 for the first retry, and so on. */
  readonly attempt: number;
}

/** Throwing from a handler fails the attempt; the queue retries it within `retryLimit`. */
export type JobHandler<T> = (job: QueuedJob<T>) => Promise<void>;

export interface WorkOptions {
  /** Jobs processed in parallel by this process for this queue. */
  readonly concurrency?: number;
  readonly pollingIntervalSeconds?: number;
}

export interface JobQueue {
  start(): Promise<void>;
  /** Stops fetching new jobs and waits for running ones up to `timeoutMs`. */
  stop(options?: { readonly timeoutMs?: number }): Promise<void>;
  ensureQueue(definition: QueueDefinition): Promise<void>;
  enqueue(queue: string, data: object, options?: EnqueueOptions): Promise<string | null>;
  work<T>(queue: string, handler: JobHandler<T>, options?: WorkOptions): Promise<void>;
}
