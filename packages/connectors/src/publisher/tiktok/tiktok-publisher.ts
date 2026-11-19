import { DomainError, err, ok, type Result } from "@gta6/domain";
import { z } from "zod";

import type { FetchLike } from "../../discovery/feed-discovery-provider";
import {
  MAX_UPLOAD_BYTES,
  readJson,
  safeFetch,
  type PlatformPublisherDeps,
} from "../platform-deps";
import {
  publishRequestSchema,
  type ExternalPublication,
  type ExternalStatus,
  type PlatformCheckpoint,
  type PublishContext,
  type PublisherAdapter,
  type PublisherCapabilities,
  type PublishRequest,
  type ReconcileResult,
} from "../publisher-adapter";

const API = "https://open.tiktokapis.com/v2/post/publish";
export const TIKTOK_CREATOR_INFO_URL = `${API}/creator_info/query/`;
export const TIKTOK_VIDEO_INIT_URL = `${API}/video/init/`;
export const TIKTOK_STATUS_URL = `${API}/status/fetch/`;

/** Chunks must be 5 to 64 MB (last one up to 128 MB); a smaller file is one chunk. */
export const TIKTOK_MIN_CHUNK = 5 * 1024 * 1024;
export const TIKTOK_CHUNK = 10 * 1024 * 1024;
/** post_info.title (the caption) is limited to 2200 UTF-16 code units. */
export const TIKTOK_MAX_CAPTION = 2200;
/** Private level; unaudited clients are restricted to it anyway. */
const PRIVATE_LEVEL = "SELF_ONLY";
/** Public level (ADR 0007). Only accepted by TikTok once the app has passed its audit. */
const PUBLIC_LEVEL = "PUBLIC_TO_EVERYONE";

export function tiktokPrivacyLevel(visibility: PublishRequest["visibility"]): string {
  return visibility === "public" ? PUBLIC_LEVEL : PRIVATE_LEVEL;
}

export const TIKTOK_CAPABILITIES: PublisherCapabilities = {
  directPublish: true,
  scheduledPublish: false,
  reconcileByRequest: true,
  privateVisibility: true,
  verifiedAgainstDocsAt: "2026-11-18",
  docsUrls: [
    "https://developers.tiktok.com/doc/content-posting-api-get-started",
    "https://developers.tiktok.com/doc/content-posting-api-reference-direct-post",
    "https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide",
    "https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status",
    "https://developers.tiktok.com/doc/content-sharing-guidelines",
  ],
};

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({
    data: data.optional(),
    error: z.object({ code: z.string(), message: z.string().optional() }),
  });

const creatorInfoSchema = envelope(
  z.object({ privacy_level_options: z.array(z.string()), creator_nickname: z.string().optional() }),
);
const initSchema = envelope(
  z.object({ publish_id: z.string().min(1).max(64), upload_url: z.url() }),
);
const statusSchema = envelope(z.object({ status: z.string(), fail_reason: z.string().optional() }));
const errorCodeSchema = z.object({ error: z.object({ code: z.string() }) });
const checkpointSchema = z.object({ publishId: z.string().min(1).max(64) });

export function captionOf(request: Pick<PublishRequest, "title" | "description">): string {
  return request.description ? `${request.title}\n\n${request.description}` : request.title;
}

/** Chunk plan from the media transfer guide; the remainder goes into the last chunk. */
export function chunkPlan(size: number): { chunkSize: number; totalChunks: number } {
  if (size < TIKTOK_MIN_CHUNK) return { chunkSize: size, totalChunks: 1 };
  return { chunkSize: TIKTOK_CHUNK, totalChunks: Math.max(1, Math.floor(size / TIKTOK_CHUNK)) };
}

function apiError(httpStatus: number, code: string | null): DomainError {
  const details = { status: httpStatus, tiktokCode: code };
  switch (code) {
    case "access_token_invalid":
    case "token_not_authorized_for_specified_open_id":
      return new DomainError("CREDENTIAL_EXPIRED", "TikTok token invalid", { details });
    case "rate_limit_exceeded":
    case "spam_risk_too_many_posts":
    case "spam_risk_too_many_pending_share":
      return new DomainError("RATE_LIMITED", "TikTok limit", { details });
    case "scope_not_authorized":
    case "unaudited_client_can_only_post_to_private_accounts":
    case "spam_risk_user_banned_from_posting":
    case "reached_active_user_cap":
      return new DomainError("FORBIDDEN", "TikTok refused the post", { details });
    case "invalid_params":
    case "privacy_level_option_mismatch":
    case "invalid_file_upload":
      return new DomainError("VALIDATION_FAILED", "TikTok rejected the request", { details });
    case "invalid_publish_id":
      return new DomainError("NOT_FOUND", "Unknown TikTok publish id", { details });
    default:
      if (httpStatus === 401)
        return new DomainError("CREDENTIAL_EXPIRED", "TikTok 401", { details });
      if (httpStatus === 429) return new DomainError("RATE_LIMITED", "TikTok 429", { details });
      return new DomainError("EXTERNAL_UNAVAILABLE", "TikTok unavailable", { details });
  }
}

function statusOf(status: string): ExternalStatus {
  if (status === "PUBLISH_COMPLETE" || status === "SEND_TO_USER_INBOX") return "published";
  if (status === "FAILED") return "rejected";
  return "processing";
}

/**
 * TikTok Content Posting API, Direct Post (T33). SELF_ONLY or, once the channel allows it,
 * PUBLIC_TO_EVERYONE, chosen explicitly by the operator for each post (TikTok's UX rules); comments, duet and stitch off; `is_aigc` from the
 * render. The publish_id is saved as checkpoint before any byte is sent, and reconciliation
 * asks its status: PUBLISH_COMPLETE/SEND_TO_USER_INBOX = exists, FAILED = safe to post again,
 * anything still in progress = unknown (never "not found", so nothing is posted twice).
 */
export class TikTokPublisher implements PublisherAdapter {
  readonly platform = "tiktok" as const;
  readonly capabilities = TIKTOK_CAPABILITIES;

  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly uploadTimeoutMs: number;

  constructor(private readonly deps: PlatformPublisherDeps) {
    this.fetchImpl = deps.fetch ?? fetch;
    this.timeoutMs = deps.timeoutMs ?? 30_000;
    this.uploadTimeoutMs = deps.uploadTimeoutMs ?? 10 * 60_000;
  }

  validate(request: PublishRequest): Result<PublishRequest, DomainError> {
    const parsed = publishRequestSchema.safeParse(request);
    if (
      !parsed.success ||
      parsed.data.scheduledAt !== null ||
      // TikTok requires the person to choose the privacy level for each post.
      !parsed.data.visibilityConfirmed ||
      captionOf(parsed.data).length > TIKTOK_MAX_CAPTION
    ) {
      return err(new DomainError("VALIDATION_FAILED", "Invalid TikTok publish request"));
    }
    return ok(parsed.data);
  }

  async publish(
    request: PublishRequest,
    context?: PublishContext,
  ): Promise<Result<ExternalPublication, DomainError>> {
    const valid = this.validate(request);
    if (!valid.ok) return valid;
    const access = await this.deps.tokens.getAccessToken(request.channelId);
    if (!access.ok) return access;
    const token = access.value.accessToken;
    const bytes = await this.deps.media.download(request.mediaRef);
    if (!bytes || bytes.length === 0 || bytes.length > MAX_UPLOAD_BYTES) {
      return err(new DomainError("VALIDATION_FAILED", "Video file missing or too large"));
    }

    // 1. The creator's allowed privacy levels must include the chosen one.
    const level = tiktokPrivacyLevel(request.visibility);
    const info = await this.call(TIKTOK_CREATOR_INFO_URL, token, {}, creatorInfoSchema);
    if (!info.ok) return info;
    if (!info.value.privacy_level_options.includes(level)) {
      return err(
        new DomainError("FORBIDDEN", `The account does not allow ${request.visibility} posts`),
      );
    }

    // 2. Init. No post exists until the whole file is uploaded.
    const plan = chunkPlan(bytes.length);
    const init = await this.call(
      TIKTOK_VIDEO_INIT_URL,
      token,
      {
        post_info: {
          title: captionOf(request),
          privacy_level: level,
          disable_comment: true,
          disable_duet: true,
          disable_stitch: true,
          brand_content_toggle: false,
          brand_organic_toggle: false,
          is_aigc: request.syntheticMedia,
        },
        source_info: {
          source: "FILE_UPLOAD",
          video_size: bytes.length,
          chunk_size: plan.chunkSize,
          total_chunk_count: plan.totalChunks,
        },
      },
      initSchema,
    );
    if (!init.ok) return init;

    // 3. Persist the publish id BEFORE sending bytes.
    await context?.saveCheckpoint({ publishId: init.value.publish_id });

    // 4. Upload the chunks in order.
    for (let index = 0; index < plan.totalChunks; index += 1) {
      const start = index * plan.chunkSize;
      const end = index === plan.totalChunks - 1 ? bytes.length : start + plan.chunkSize;
      const response = await safeFetch(
        this.fetchImpl,
        init.value.upload_url,
        {
          method: "PUT",
          headers: {
            "Content-Type": "video/mp4",
            "Content-Range": `bytes ${String(start)}-${String(end - 1)}/${String(bytes.length)}`,
          },
          body: bytes.subarray(start, end),
        },
        this.uploadTimeoutMs,
      );
      if (!response || response.status >= 500) {
        return err(new DomainError("AMBIGUOUS_EXTERNAL_STATE", "Upload outcome unknown"));
      }
      if (response.status !== 201 && response.status !== 206 && response.status !== 200) {
        return err(new DomainError("EXTERNAL_UNAVAILABLE", "TikTok refused a chunk"));
      }
    }

    // 5. One status read so the result says how far TikTok got.
    const status = await this.status(token, init.value.publish_id);
    return ok({
      externalId: init.value.publish_id,
      permalink: null,
      status: status.ok ? statusOf(status.value.status) : "processing",
    });
  }

  async reconcile(
    request: PublishRequest,
    checkpoint?: PlatformCheckpoint | null,
  ): Promise<Result<ReconcileResult, DomainError>> {
    const saved = checkpointSchema.safeParse(checkpoint);
    if (!saved.success) return ok({ found: false });
    const access = await this.deps.tokens.getAccessToken(request.channelId);
    if (!access.ok) return access;
    const status = await this.status(access.value.accessToken, saved.data.publishId);
    if (!status.ok) {
      // An unknown publish id means TikTok never accepted the init: nothing was posted.
      return status.error.code === "NOT_FOUND" ? ok({ found: false }) : status;
    }
    const { status: state } = status.value;
    if (state === "FAILED") return ok({ found: false });
    if (state === "PUBLISH_COMPLETE" || state === "SEND_TO_USER_INBOX") {
      return ok({
        found: true,
        publication: { externalId: saved.data.publishId, permalink: null, status: "published" },
      });
    }
    return err(
      new DomainError("EXTERNAL_UNAVAILABLE", "TikTok is still processing", {
        details: { tiktokStatus: state },
      }),
    );
  }

  async getStatus(
    externalId: string,
    channelId?: string,
  ): Promise<Result<ExternalPublication, DomainError>> {
    if (!channelId) return err(new DomainError("VALIDATION_FAILED", "channelId is required"));
    const access = await this.deps.tokens.getAccessToken(channelId);
    if (!access.ok) return access;
    const status = await this.status(access.value.accessToken, externalId);
    if (!status.ok) return status;
    return ok({ externalId, permalink: null, status: statusOf(status.value.status) });
  }

  private status(token: string, publishId: string) {
    return this.call(TIKTOK_STATUS_URL, token, { publish_id: publishId }, statusSchema);
  }

  private async call<T>(
    url: string,
    token: string,
    body: unknown,
    schema: z.ZodType<{ data?: T | undefined; error: { code: string } }>,
  ): Promise<Result<T, DomainError>> {
    const response = await safeFetch(
      this.fetchImpl,
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify(body),
      },
      this.timeoutMs,
    );
    if (!response) return err(new DomainError("EXTERNAL_UNAVAILABLE", "TikTok unreachable"));
    const answer = await readJson(response);
    const code = errorCodeSchema.safeParse(answer).data?.error.code ?? null;
    if (!response.ok || code !== "ok") return err(apiError(response.status, code));
    const parsed = schema.safeParse(answer);
    if (!parsed.success || parsed.data.data === undefined) {
      return err(new DomainError("EXTERNAL_UNAVAILABLE", "Unexpected TikTok answer"));
    }
    return ok(parsed.data.data);
  }
}
