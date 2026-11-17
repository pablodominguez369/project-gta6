import { SimulatedPublisher } from "@gta6/connectors";
import { createAdminClient } from "@gta6/db";
import {
  createPublishHandler,
  PgBossQueue,
  PgPublicationStore,
  PgSimulatedRemoteStore,
  publishSimulatedPayloadSchema,
  QUEUES,
  startDispatcher,
  trackJobRuns,
  type JobQueue,
} from "@gta6/jobs";
import { createLogger, type Logger } from "@gta6/observability";
import pg from "pg";

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

  // Phase 1: the only publisher is the simulator (PUBLISHING_MODE is validated as "simulated").
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 5 });
  pool.on("error", (error) => {
    logger.error({ err: error }, "database pool error");
  });
  const publisher = new SimulatedPublisher({ store: new PgSimulatedRemoteStore(pool) });
  await queue.work(
    QUEUES.publishSimulated.name,
    trackJobRuns(
      db,
      logger,
      createPublishHandler(
        { store: new PgPublicationStore(pool), publisher },
        QUEUES.publishSimulated,
      ),
      {
        targetType: "publications",
        targetId: (data) => publishSimulatedPayloadSchema.safeParse(data).data?.publicationId,
      },
    ),
  );
  const dispatcher = startDispatcher(pool, queue, logger);

  logger.info({ queues: Object.values(QUEUES).map((q) => q.name) }, "worker started");

  return {
    queue,
    logger,
    async stop() {
      logger.info("worker stopping");
      await dispatcher.stop();
      await queue.stop({ timeoutMs: 30_000 });
      await pool.end();
      logger.info("worker stopped");
    },
  };
}
