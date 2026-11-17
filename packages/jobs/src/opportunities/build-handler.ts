import type pg from "pg";

import type { TrackedJobHandler } from "../job-runs";
import { buildOpportunities } from "./build-opportunities";

/** Queue handler for `opportunity.build`. */
export function createOpportunityBuildHandler(pool: pg.Pool): TrackedJobHandler<unknown> {
  return async (_job, { logger }) => {
    await buildOpportunities(pool, logger);
    return { status: "succeeded" };
  };
}
