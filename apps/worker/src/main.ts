import { startWorker } from "./worker";

const worker = await startWorker();

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  worker.logger.info({ signal }, "shutdown requested");
  try {
    await worker.stop();
    process.exit(0);
  } catch (error) {
    worker.logger.error({ err: error }, "shutdown failed");
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
