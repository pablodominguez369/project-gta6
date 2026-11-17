import { createAdminClient } from "@gta6/db";
import { PgBossQueue, QUEUES, trackJobRuns, type JobQueue } from "@gta6/jobs";
import { createLogger, type Logger } from "@gta6/observability";

import { loadWorkerEnv } from "./env";
import { handleSystemPing } from "./handlers/system-ping";

export interface RunningWorker {
  readonly queue: JobQueue;
  readonly logger: Logger;
  stop(): Promise<void>;
}

/** Builds and starts the worker. Separate from main.ts so integration tests can run it in-process. */
export async function startWorker(source: NodeJS.ProcessEnv = process.env): Promise<RunningWorker> {
  const env = loadWorkerEnv(source);
  const logger = createLogger({
    name: "worker",
    level: env.LOG_LEVEL,
    base: { appEnv: env.APP_ENV, publishingMode: env.PUBLISHING_MODE },
  });
  const db = createAdminClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY);
  const queue = new PgBossQueue({
    connectionString: env.DATABASE_URL,
    onError: (error) => {
      logger.error({ err: error }, "queue error");
    },
  });

  await queue.start();
  for (const definition of Object.values(QUEUES)) {
    await queue.ensureQueue(definition);
  }

  await queue.work(QUEUES.systemPing.name, trackJobRuns(db, logger, handleSystemPing));

  logger.info({ queues: Object.values(QUEUES).map((q) => q.name) }, "worker started");

  return {
    queue,
    logger,
    async stop() {
      logger.info("worker stopping");
      await queue.stop({ timeoutMs: 30_000 });
      logger.info("worker stopped");
    },
  };
}
