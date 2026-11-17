import {
  createLlmProvider,
  DisabledLlmProvider,
  EnvSecretStore,
  SimulatedPublisher,
  type LlmProvider,
} from "@gta6/connectors";
import { createAdminClient } from "@gta6/db";
import {
  createDiscoveryPollHandler,
  createOpportunityBuildHandler,
  createPublishHandler,
  createScriptDraftHandler,
  PgBossQueue,
  PgLlmUsageStore,
  PgPublicationStore,
  PgSimulatedRemoteStore,
  publishSimulatedPayloadSchema,
  QUEUES,
  scheduleDiscoveryPoll,
  scriptDraftPayloadSchema,
  startDispatcher,
  startScriptDispatcher,
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

  // Phase 2: allowlisted feeds only (admins enable a feed after reviewing its terms).
  await queue.work(
    QUEUES.discoveryPoll.name,
    trackJobRuns(db, logger, createDiscoveryPollHandler(pool, queue)),
  );
  await queue.work(
    QUEUES.opportunityBuild.name,
    trackJobRuns(db, logger, createOpportunityBuildHandler(pool)),
  );
  const discoverySchedule = scheduleDiscoveryPoll(queue);

  // LLM drafting: off unless configured, and every call goes through the spend gate.
  const provider = await buildLlmProvider(env, logger);
  await queue.work(
    QUEUES.scriptDraft.name,
    trackJobRuns(
      db,
      logger,
      createScriptDraftHandler({ pool, provider, store: new PgLlmUsageStore(pool) }),
      {
        targetType: "script_requests",
        targetId: (data) => scriptDraftPayloadSchema.safeParse(data).data?.requestId,
      },
    ),
  );
  const scriptDispatcher = startScriptDispatcher(pool, queue, logger);

  logger.info({ queues: Object.values(QUEUES).map((q) => q.name) }, "worker started");

  return {
    queue,
    logger,
    async stop() {
      logger.info("worker stopping");
      discoverySchedule.stop();
      await dispatcher.stop();
      await scriptDispatcher.stop();
      await queue.stop({ timeoutMs: 30_000 });
      await pool.end();
      logger.info("worker stopped");
    },
  };
}

/** Falls back to the disabled provider on any configuration problem (safe block). */
async function buildLlmProvider(
  env: ReturnType<typeof loadWorkerEnv>,
  logger: Logger,
): Promise<LlmProvider> {
  const result = await createLlmProvider(
    { provider: env.LLM_PROVIDER, model: env.LLM_MODEL, apiKeyRef: env.LLM_API_KEY_REF },
    new EnvSecretStore(env.APP_ENV),
  );
  if (!result.ok) {
    logger.error({ errorCode: result.error.code }, "LLM provider unavailable; drafting disabled");
    return new DisabledLlmProvider();
  }
  logger.info({ llmProvider: result.value.name }, "LLM provider ready");
  return result.value;
}
