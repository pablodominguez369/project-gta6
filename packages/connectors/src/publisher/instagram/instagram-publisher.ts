import { DomainError, err, ok, type Result } from "@gta6/domain";
import { z } from "zod";

import type { FetchLike } from "../../discovery/feed-discovery-provider";
import { readJson, safeFetch, type PlatformPublisherDeps } from "../platform-deps";
import {
  publishRequestSchema,
  type ExternalPublication,
  type PlatformCheckpoint,
  type PublishContext,
  type PublisherAdapter,
  type PublisherCapabilities,
  type PublishRequest,
  type ReconcileResult,
} from "../publisher-adapter";

export const INSTAGRAM_GRAPH_HOST = "https://graph.instagram.com";
export const INSTAGRAM_MAX_CAPTION = 2200;
/** The signed URL only has to live while Meta downloads the file. */
const SIGNED_URL_SECONDS = 3600;

export const INSTAGRAM_CAPABILITIES: PublisherCapabilities = {
  directPublish: true,
  scheduledPublish: false,
  reconcileByRequest: true,
  // Instagram has no private or draft visibility through the API: every post is public. The
  // orchestrator therefore never calls this adapter in Phase 4 (ADR 0005).
  privateVisibility: false,
  verifiedAgainstDocsAt: "2026-11-18",
  docsUrls: [
    "https://developers.facebook.com/docs/instagram-platform/content-publishing/",
    "https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit",
  ],
};

export interface InstagramPublisherOptions extends PlatformPublisherDeps {
  /**
   * Graph API version path, e.g. "v24.0". No default on purpose: set it from Meta's changelog
   * when the adapter is enabled, after re-checking the docs.
   */
  readonly graphVersion: string;
  /**
   * Second lock besides the orchestrator: without the owner's written authorization for PUBLIC
   * posts (Phase 6 at the earliest) every publish is refused before any call.
   */
  readonly publicPostsAuthorized: boolean;
  readonly pollIntervalMs?: number;
  readonly maxPolls?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const idSchema = z.object({ id: z.string().min(1) });
const containerSchema = z.object({ status_code: z.string() });
const mediaSchema = z.object({ id: z.string().min(1), permalink: z.url().optional() });
const mediaListSchema = z.object({
  data: z.array(
    z.object({ id: z.string(), caption: z.string().optional(), permalink: z.url().optional() }),
  ),
});
const checkpointSchema = z.object({ containerId: z.string().min(1).max(64) });

function captionOf(request: Pick<PublishRequest, "title" | "description">): string {
  return request.description ? `${request.title}\n\n${request.description}` : request.title;
}

function apiError(status: number, body: unknown): DomainError {
  const code = z.object({ error: z.object({ code: z.number() }) }).safeParse(body).data?.error.code;
  const details = { status, metaCode: code ?? null };
  if (status === 401 || code === 190) {
    return new DomainError("CREDENTIAL_EXPIRED", "Instagram token invalid", { details });
  }
  if (status === 429 || code === 4 || code === 9 || code === 17 || code === 32) {
    return new DomainError("RATE_LIMITED", "Instagram limit", { details });
  }
  if (status === 403 || code === 10 || code === 200) {
    return new DomainError("FORBIDDEN", "Instagram permission", { details });
  }
  if (code === 100 && status === 400) {
    return new DomainError("VALIDATION_FAILED", "Instagram rejected the request", { details });
  }
  if (status === 404) return new DomainError("NOT_FOUND", "Instagram 404", { details });
  return new DomainError("EXTERNAL_UNAVAILABLE", "Instagram unavailable", { details });
}

/**
 * Instagram API with Instagram Login (T34): Reel container with a signed `video_url`, status
 * polling, then `media_publish`. The container id is the checkpoint: a container that reports
 * PUBLISHED already became a post. Not registered in the Phase 4 worker.
 */
export class InstagramPublisher implements PublisherAdapter {
  readonly platform = "instagram" as const;
  readonly capabilities = INSTAGRAM_CAPABILITIES;

  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly base: string;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: InstagramPublisherOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.base = `${INSTAGRAM_GRAPH_HOST}/${encodeURIComponent(options.graphVersion)}`;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  validate(request: PublishRequest): Result<PublishRequest, DomainError> {
    const parsed = publishRequestSchema.safeParse(request);
    if (
      !parsed.success ||
      parsed.data.scheduledAt !== null ||
      captionOf(parsed.data).length > INSTAGRAM_MAX_CAPTION
    ) {
      return err(new DomainError("VALIDATION_FAILED", "Invalid Instagram publish request"));
    }
    return ok(parsed.data);
  }

  async publish(
    request: PublishRequest,
    context?: PublishContext,
  ): Promise<Result<ExternalPublication, DomainError>> {
    const valid = this.validate(request);
    if (!valid.ok) return valid;
    if (!this.options.publicPostsAuthorized) {
      return err(new DomainError("FORBIDDEN", "Instagram posts are public; not authorized"));
    }
    const access = await this.deps(request.channelId);
    if (!access.ok) return access;
    const { token, igId } = access.value;
    const videoUrl = await this.options.media.signedUrl?.(request.mediaRef, SIGNED_URL_SECONDS);
    if (!videoUrl) return err(new DomainError("VALIDATION_FAILED", "No video URL for Instagram"));

    // 1. Container (no post yet).
    const container = await this.call("POST", `/${igId}/media`, token, idSchema, {
      media_type: "REELS",
      video_url: videoUrl,
      caption: captionOf(request),
    });
    if (!container.ok) return container;
    await context?.saveCheckpoint({ containerId: container.value.id });

    // 2. Wait until Meta has processed the video (docs: once a minute, up to 5 minutes).
    const ready = await this.waitFinished(container.value.id, token);
    if (!ready.ok) return ready;

    // 3. Publish: from here the outcome can be lost.
    const published = await safeFetch(
      this.fetchImpl,
      `${this.base}/${igId}/media_publish`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ creation_id: container.value.id }),
      },
      this.timeoutMs,
    );
    if (!published || published.status >= 500) {
      return err(new DomainError("AMBIGUOUS_EXTERNAL_STATE", "Publish outcome unknown"));
    }
    const body = await readJson(published);
    const media = idSchema.safeParse(body);
    if (!published.ok || !media.success) return err(apiError(published.status, body));
    const details = await this.call(
      "GET",
      `/${media.data.id}?fields=id,permalink`,
      token,
      mediaSchema,
    );
    return ok({
      externalId: media.data.id,
      permalink: details.ok ? (details.value.permalink ?? null) : null,
      status: "published",
    });
  }

  async reconcile(
    request: PublishRequest,
    checkpoint?: PlatformCheckpoint | null,
  ): Promise<Result<ReconcileResult, DomainError>> {
    const saved = checkpointSchema.safeParse(checkpoint);
    if (!saved.success) return ok({ found: false });
    const access = await this.deps(request.channelId);
    if (!access.ok) return access;
    const { token, igId } = access.value;
    const status = await this.call(
      "GET",
      `/${saved.data.containerId}?fields=status_code`,
      token,
      containerSchema,
    );
    if (!status.ok) return status;
    // Only a PUBLISHED container became a post; the others expire on their own after 24 h.
    if (status.value.status_code !== "PUBLISHED") return ok({ found: false });
    const recent = await this.call(
      "GET",
      `/${igId}/media?fields=id,caption,permalink&limit=25`,
      token,
      mediaListSchema,
    );
    const match = recent.ok
      ? recent.value.data.find((item) => item.caption === captionOf(request))
      : undefined;
    return ok({
      found: true,
      publication: {
        externalId: match?.id ?? `container:${saved.data.containerId}`,
        permalink: match?.permalink ?? null,
        status: "published",
      },
    });
  }

  async getStatus(
    externalId: string,
    channelId?: string,
  ): Promise<Result<ExternalPublication, DomainError>> {
    if (!channelId) return err(new DomainError("VALIDATION_FAILED", "channelId is required"));
    const access = await this.deps(channelId);
    if (!access.ok) return access;
    const media = await this.call(
      "GET",
      `/${encodeURIComponent(externalId)}?fields=id,permalink`,
      access.value.token,
      mediaSchema,
    );
    if (!media.ok) {
      // Meta answers "object does not exist" as a 400 with code 100.
      return media.error.code === "VALIDATION_FAILED"
        ? err(new DomainError("NOT_FOUND", "Unknown Instagram media"))
        : media;
    }
    return ok({ externalId, permalink: media.value.permalink ?? null, status: "published" });
  }

  private async deps(
    channelId: string,
  ): Promise<Result<{ token: string; igId: string }, DomainError>> {
    const access = await this.options.tokens.getAccessToken(channelId);
    if (!access.ok) return access;
    const igId = access.value.accountId;
    if (!igId || !/^\d+$/.test(igId)) {
      return err(new DomainError("CREDENTIAL_EXPIRED", "Instagram account id missing; reconnect"));
    }
    return ok({ token: access.value.accessToken, igId });
  }

  private async waitFinished(
    containerId: string,
    token: string,
  ): Promise<Result<true, DomainError>> {
    const polls = this.options.maxPolls ?? 5;
    for (let poll = 0; poll < polls; poll += 1) {
      await this.sleep(this.options.pollIntervalMs ?? 60_000);
      const status = await this.call(
        "GET",
        `/${containerId}?fields=status_code`,
        token,
        containerSchema,
      );
      if (!status.ok) return status;
      if (status.value.status_code === "FINISHED") return ok(true);
      if (status.value.status_code === "ERROR" || status.value.status_code === "EXPIRED") {
        return err(
          new DomainError("VALIDATION_FAILED", "Instagram could not process the video", {
            details: { statusCode: status.value.status_code },
          }),
        );
      }
    }
    // Not ready: nothing is published; the retry reconciles (not PUBLISHED) and starts again.
    return err(new DomainError("EXTERNAL_UNAVAILABLE", "Instagram is still processing"));
  }

  private async call<T>(
    method: "GET" | "POST",
    path: string,
    token: string,
    schema: z.ZodType<T>,
    body?: Readonly<Record<string, string>>,
  ): Promise<Result<T, DomainError>> {
    const response = await safeFetch(
      this.fetchImpl,
      `${this.base}${path}`,
      {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
      this.timeoutMs,
    );
    if (!response) return err(new DomainError("EXTERNAL_UNAVAILABLE", "Instagram unreachable"));
    const answer = await readJson(response);
    if (!response.ok) return err(apiError(response.status, answer));
    const parsed = schema.safeParse(answer);
    return parsed.success
      ? ok(parsed.data)
      : err(new DomainError("EXTERNAL_UNAVAILABLE", "Unexpected Instagram answer"));
  }
}
