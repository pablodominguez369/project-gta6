import { PgBoss } from "pg-boss";

import type {
  EnqueueOptions,
  JobHandler,
  JobQueue,
  QueueDefinition,
  WorkOptions,
} from "./job-queue";

export interface PgBossQueueOptions {
  /** Direct Postgres connection or session pooler. Transaction pooling is not supported. */
  readonly connectionString: string;
  /** Schema where pg-boss keeps its tables. Kept out of `public`, so PostgREST never exposes it. */
  readonly schema?: string;
  readonly applicationName?: string;
  /** Called for internal pg-boss errors (connection loss, maintenance failures). */
  readonly onError?: (error: Error) => void;
}

export const DEFAULT_QUEUE_SCHEMA = "pgboss";

export class PgBossQueue implements JobQueue {
  private readonly boss: PgBoss;

  constructor(options: PgBossQueueOptions) {
    this.boss = new PgBoss({
      connectionString: options.connectionString,
      schema: options.schema ?? DEFAULT_QUEUE_SCHEMA,
      application_name: options.applicationName ?? "gta6-worker",
    });
    this.boss.on("error", (error: Error) => {
      options.onError?.(error);
    });
  }

  async start(): Promise<void> {
    await this.boss.start();
  }

  async stop(options: { readonly timeoutMs?: number } = {}): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: options.timeoutMs ?? 30_000 });
  }

  async ensureQueue(definition: QueueDefinition): Promise<void> {
    const settings = {
      retryLimit: definition.retryLimit,
      retryDelay: definition.retryDelaySeconds,
      retryBackoff: true,
      expireInSeconds: definition.expireInSeconds,
    };
    const existing = await this.boss.getQueue(definition.name);
    if (!existing) {
      await this.boss.createQueue(definition.name, { ...settings, policy: definition.policy });
      return;
    }
    if (existing.policy !== definition.policy) {
      // Policies cannot be changed in place; changing one needs an explicit migration.
      throw new Error(
        `Queue ${definition.name} has policy ${String(existing.policy)}, expected ${definition.policy}`,
      );
    }
    await this.boss.updateQueue(definition.name, settings);
  }

  async enqueue(queue: string, data: object, options: EnqueueOptions = {}): Promise<string | null> {
    return this.boss.send(queue, data, {
      ...(options.singletonKey === undefined ? {} : { singletonKey: options.singletonKey }),
      ...(options.startAfter === undefined ? {} : { startAfter: options.startAfter }),
    });
  }

  async work<T>(queue: string, handler: JobHandler<T>, options: WorkOptions = {}): Promise<void> {
    await this.boss.work<T>(
      queue,
      {
        batchSize: 1,
        localConcurrency: options.concurrency ?? 1,
        ...(options.pollingIntervalSeconds === undefined
          ? {}
          : { pollingIntervalSeconds: options.pollingIntervalSeconds }),
      },
      async (jobs) => {
        for (const job of jobs) {
          await handler({
            id: job.id,
            queue: job.name,
            data: job.data,
            attempt: job.retryCount + 1,
          });
        }
      },
    );
  }
}
