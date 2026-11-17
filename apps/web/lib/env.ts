import "server-only";

import { loadEnvOrThrow, webServerEnvSchema, type WebServerEnv } from "@gta6/config";

let cached: WebServerEnv | undefined;

/** Server-side environment, validated once per process. Throws on invalid configuration. */
export function serverEnv(): WebServerEnv {
  cached ??= loadEnvOrThrow(webServerEnvSchema, process.env);
  return cached;
}
