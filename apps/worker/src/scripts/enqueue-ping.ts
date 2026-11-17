import { PgBossQueue, QUEUES } from "@gta6/jobs";
import { createLogger } from "@gta6/observability";

import { loadWorkerEnv } from "../env";

// Local diagnostic: enqueue one system.ping and exit. The running worker processes it.
const env = loadWorkerEnv();
const logger = createLogger({ name: "enqueue-ping", level: env.LOG_LEVEL });
const queue = new PgBossQueue({ connectionString: env.DATABASE_URL });
await queue.start();
await queue.ensureQueue(QUEUES.systemPing);
const id = await queue.enqueue(QUEUES.systemPing.name, { requestedAt: new Date().toISOString() });
logger.info({ jobId: id }, "system.ping enqueued");
await queue.stop();
