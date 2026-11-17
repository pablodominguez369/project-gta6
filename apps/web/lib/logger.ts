import "server-only";

import { createLogger } from "@gta6/observability";

import { serverEnv } from "./env";

export const logger = createLogger({
  name: "web",
  level: serverEnv().LOG_LEVEL,
  base: { appEnv: serverEnv().APP_ENV },
});
