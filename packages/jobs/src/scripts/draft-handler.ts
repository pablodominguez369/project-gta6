import type { TrackedJobHandler } from "../job-runs";
import { scriptDraftPayloadSchema } from "../definitions";
import { draftScript, type DraftScriptDeps } from "./draft-script";

/** Queue handler for `script.draft`. Never throws for business outcomes: no blind queue retry. */
export function createScriptDraftHandler(
  deps: Omit<DraftScriptDeps, "logger">,
): TrackedJobHandler<unknown> {
  return async (job, { logger }) => {
    const payload = scriptDraftPayloadSchema.safeParse(job.data);
    if (!payload.success) return { status: "failed", errorCode: "VALIDATION_FAILED" };
    const outcome = await draftScript({ ...deps, logger }, payload.data.requestId);
    switch (outcome.kind) {
      case "succeeded":
      case "skipped":
        return { status: "succeeded" };
      case "blocked":
        return { status: "blocked", errorCode: outcome.code };
      case "failed":
        return { status: "failed", errorCode: outcome.code };
    }
  };
}
