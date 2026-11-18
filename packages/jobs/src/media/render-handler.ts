import { mediaRenderPayloadSchema } from "../definitions";
import type { TrackedJobHandler } from "../job-runs";
import { renderProject, type RenderDeps } from "./render-project";

/** Queue handler for `media.render`. Never throws for business outcomes: no blind queue retry. */
export function createMediaRenderHandler(
  deps: Omit<RenderDeps, "logger">,
): TrackedJobHandler<unknown> {
  return async (job, { logger }) => {
    const payload = mediaRenderPayloadSchema.safeParse(job.data);
    if (!payload.success) return { status: "failed", errorCode: "VALIDATION_FAILED" };
    const outcome = await renderProject({ ...deps, logger }, payload.data.projectId);
    switch (outcome.kind) {
      case "rendered":
      case "skipped":
        return { status: "succeeded" };
      case "retry":
        return { status: "blocked", errorCode: outcome.code };
      case "blocked":
        return { status: "blocked", errorCode: "RIGHTS_BLOCKED" };
      case "failed":
        return { status: "failed", errorCode: outcome.code };
    }
  };
}
