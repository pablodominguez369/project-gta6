import {
  CompositeSecretStore,
  createLlmProvider,
  DisabledLlmProvider,
  DisabledTtsProvider,
  EnvSecretStore,
  FakeTtsProvider,
  loadOAuthProvider,
  SimulatedPublisher,
  VaultSecretStore,
  YouTubePublisher,
  type LlmProvider,
  type SecretStore,
  type TtsProvider,
} from "@gta6/connectors";
import { createAdminClient } from "@gta6/db";
import {
  createDiscoveryPollHandler,
  createMediaRenderHandler,
  createOpportunityBuildHandler,
  createPublishHandler,
  createScriptDraftHandler,
  PgBossQueue,
  PgLlmUsageStore,
  SupabaseMediaStore,
  PgChannelTokens,
  PgPublicationStore,
  PgSimulatedRemoteStore,
  mediaRenderPayloadSchema,
  publishSimulatedPayloadSchema,
  QUEUES,
  scheduleDiscoveryPoll,
  scriptDraftPayloadSchema,
  startDispatcher,
  startMediaDispatcher,
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

  // Publishers by platform. Real adapters are only reached through the gates of ADR 0005:
  // PUBLISHING_MODE=live, the channel switch and an active credential; uploads are private.
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 5 });
  pool.on("error", (error) => {
    logger.error({ err: error }, "database pool error");
  });
  const publisher = new SimulatedPublisher({ store: new PgSimulatedRemoteStore(pool) });
  const secrets = new CompositeSecretStore([
    new EnvSecretStore(env.APP_ENV),
    new VaultSecretStore(async (secretRef) => {
      const { rows } = await pool.query<{ secret: string | null }>(
        "select public.read_vault_secret($1) as secret",
        [secretRef],
      );
      return rows[0]?.secret ?? null;
    }),
  ]);
  const channelTokens = new PgChannelTokens(
    pool,
    (platform) => loadOAuthProvider(platform, env, secrets),
    logger,
  );
  const renders = new SupabaseMediaStore(db);
  const youtube = new YouTubePublisher({ tokens: channelTokens, media: renders });
  await queue.work(
    QUEUES.publishSimulated.name,
    trackJobRuns(
      db,
      logger,
      createPublishHandler(
        {
          store: new PgPublicationStore(pool),
          publishers: { simulated: publisher, youtube },
          publishingMode: env.PUBLISHING_MODE,
        },
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
  const provider = await buildLlmProvider(env, logger, secrets);
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

  // Phase 3: renders. Rights, voice and file hashes are checked before anything is produced,
  // and narration goes through the same spend gate as the LLM.
  const tts = buildTtsProvider(env, logger);
  await queue.work(
    QUEUES.mediaRender.name,
    trackJobRuns(
      db,
      logger,
      createMediaRenderHandler({
        pool,
        tts,
        store: new PgLlmUsageStore(pool),
        media: new SupabaseMediaStore(db),
        binaries: { ffmpeg: env.FFMPEG_PATH, ffprobe: env.FFPROBE_PATH },
        fontsDir: env.RENDER_FONTS_DIR,
      }),
      {
        targetType: "media_projects",
        targetId: (data) => mediaRenderPayloadSchema.safeParse(data).data?.projectId,
      },
    ),
  );
  const mediaDispatcher = startMediaDispatcher(pool, queue, logger);

  logger.info({ queues: Object.values(QUEUES).map((q) => q.name) }, "worker started");

  return {
    queue,
    logger,
    async stop() {
      logger.info("worker stopping");
      discoverySchedule.stop();
      await dispatcher.stop();
      await scriptDispatcher.stop();
      await mediaDispatcher.stop();
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
  secrets: SecretStore,
): Promise<LlmProvider> {
  // env:// locally, vault:// in staging/production (the same store as platform secrets).
  const result = await createLlmProvider(
    { provider: env.LLM_PROVIDER, model: env.LLM_MODEL, apiKeyRef: env.LLM_API_KEY_REF },
    secrets,
  );
  if (!result.ok) {
    logger.error({ errorCode: result.error.code }, "LLM provider unavailable; drafting disabled");
    return new DisabledLlmProvider();
  }
  logger.info({ llmProvider: result.value.name }, "LLM provider ready");
  return result.value;
}

/** Only the local fake exists today; anything else keeps narration off (safe block). */
function buildTtsProvider(env: ReturnType<typeof loadWorkerEnv>, logger: Logger): TtsProvider {
  const provider = env.TTS_PROVIDER === "fake" ? new FakeTtsProvider() : new DisabledTtsProvider();
  logger.info({ ttsProvider: provider.name }, "TTS provider ready");
  return provider;
}
