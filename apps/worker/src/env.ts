import { loadEnvOrThrow, workerEnvSchema, type WorkerEnv } from "@gta6/config";

/** Validated once at start-up. An invalid configuration stops the process before any work. */
export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  return loadEnvOrThrow(workerEnvSchema, source);
}
