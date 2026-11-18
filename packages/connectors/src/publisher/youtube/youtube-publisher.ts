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

export const YOUTUBE_UPLOAD_URL =
  "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
export const YOUTUBE_VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";
/** YouTube category "Gaming". */
const CATEGORY_GAMING = "20";

export const YOUTUBE_CAPABILITIES: PublisherCapabilities = {
  directPublish: true,
  // status.publishAt would make a private video PUBLIC at that time: never used in Phase 4.
  scheduledPublish: false,
  reconcileByRequest: true,
  privateVisibility: true,
  verifiedAgainstDocsAt: "2026-11-18",
  docsUrls: [
    "https://developers.google.com/youtube/v3/docs/videos/insert",
    "https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol",
    "https://developers.google.com/youtube/v3/docs/videos",
    "https://developers.google.com/youtube/v3/docs/videos/list",
  ],
};

const checkpointSchema = z.object({
  /** Resumable session URI. Ids only: no token. Hidden from members (column privileges). */
  sessionUri: z.url().startsWith("https://www.googleapis.com/upload/youtube/v3/videos"),
  sizeBytes: z.number().int().positive(),
});

const videoSchema = z.object({
  id: z.string().min(1),
  status: z
    .object({ uploadStatus: z.string().optional(), privacyStatus: z.string().optional() })
    .optional(),
});

const listSchema = z.object({ items: z.array(videoSchema) });

/** YouTube forbids < and > in titles and descriptions; descriptions are limited in BYTES. */
function validMetadata(request: PublishRequest): boolean {
  if (/[<>]/.test(request.title) || /[<>]/.test(request.description)) return false;
  return new TextEncoder().encode(request.description).length <= 5_000;
}

function statusOf(uploadStatus: string | undefined): ExternalStatus {
  switch (uploadStatus) {
    case "processed":
      return "published";
    case "failed":
    case "rejected":
    case "deleted":
      return "rejected";
    default:
      return "processing";
  }
}

function toPublication(video: z.infer<typeof videoSchema>): ExternalPublication {
  return {
    externalId: video.id,
    permalink: `https://youtu.be/${encodeURIComponent(video.id)}`,
    status: statusOf(video.status?.uploadStatus),
  };
}

/** HTTP errors of metadata calls. Nothing was created when one of these is returned. */
function apiError(status: number, body: unknown): DomainError {
  const reason = /"reason"\s*:\s*"([A-Za-z]+)"/.exec(JSON.stringify(body ?? {}))?.[1] ?? null;
  const details = { status, reason };
  if (status === 401) return new DomainError("CREDENTIAL_EXPIRED", "YouTube 401", { details });
  if (status === 429 || reason === "quotaExceeded" || reason === "uploadLimitExceeded") {
    return new DomainError("RATE_LIMITED", "YouTube quota or rate limit", { details });
  }
  if (status === 403) return new DomainError("FORBIDDEN", "YouTube 403", { details });
  if (status === 400) return new DomainError("VALIDATION_FAILED", "YouTube 400", { details });
  if (status === 404) return new DomainError("NOT_FOUND", "YouTube 404", { details });
  return new DomainError("EXTERNAL_UNAVAILABLE", "YouTube unavailable", { details });
}

/**
 * YouTube Data API v3 publisher (T32). Always uploads PRIVATE (ADR 0005), declares synthetic
 * media and "not made for kids", never sets publishAt. Reconciliation uses the resumable session
 * saved as checkpoint before any byte is sent: asking the session for its status tells whether
 * the upload completed (201 + video) or not (308/404), so a lost response never duplicates.
 */
export class YouTubePublisher implements PublisherAdapter {
  readonly platform = "youtube" as const;
  readonly capabilities = YOUTUBE_CAPABILITIES;

  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly uploadTimeoutMs: number;

  constructor(private readonly deps: PlatformPublisherDeps) {
    this.fetchImpl = deps.fetch ?? fetch;
    this.timeoutMs = deps.timeoutMs ?? 30_000;
    this.uploadTimeoutMs = deps.uploadTimeoutMs ?? 15 * 60_000;
  }

  validate(request: PublishRequest): Result<PublishRequest, DomainError> {
    const parsed = publishRequestSchema.safeParse(request);
    if (!parsed.success || !validMetadata(parsed.data) || parsed.data.scheduledAt !== null) {
      return err(new DomainError("VALIDATION_FAILED", "Invalid YouTube publish request"));
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
    const bytes = await this.deps.media.download(request.mediaRef);
    if (!bytes || bytes.length === 0 || bytes.length > MAX_UPLOAD_BYTES) {
      return err(new DomainError("VALIDATION_FAILED", "Video file missing or too large"));
    }
    const auth = `Bearer ${access.value.accessToken}`;

    // 1. Start a resumable session. Nothing exists on YouTube until the bytes arrive.
    const start = await safeFetch(
      this.fetchImpl,
      YOUTUBE_UPLOAD_URL,
      {
        method: "POST",
        headers: {
          Authorization: auth,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Length": String(bytes.length),
          "X-Upload-Content-Type": "video/mp4",
        },
        body: JSON.stringify({
          snippet: {
            title: request.title,
            description: request.description,
            categoryId: CATEGORY_GAMING,
          },
          status: {
            privacyStatus: request.visibility,
            selfDeclaredMadeForKids: false,
            containsSyntheticMedia: request.syntheticMedia,
          },
        }),
      },
      this.timeoutMs,
    );
    if (!start) return err(new DomainError("EXTERNAL_UNAVAILABLE", "YouTube unreachable"));
    if (!start.ok) return err(apiError(start.status, await readJson(start)));
    const sessionUri = start.headers.get("location");
    const checkpoint = checkpointSchema.safeParse({ sessionUri, sizeBytes: bytes.length });
    if (!checkpoint.success) {
      return err(new DomainError("EXTERNAL_UNAVAILABLE", "YouTube returned no upload session"));
    }

    // 2. Persist the session BEFORE sending bytes: from here on the outcome can be lost.
    await context?.saveCheckpoint(checkpoint.data);

    // 3. Send the file in one request.
    const upload = await safeFetch(
      this.fetchImpl,
      checkpoint.data.sessionUri,
      {
        method: "PUT",
        headers: { Authorization: auth, "Content-Type": "video/mp4" },
        body: bytes,
      },
      this.uploadTimeoutMs,
    );
    if (!upload || upload.status >= 500) {
      return err(new DomainError("AMBIGUOUS_EXTERNAL_STATE", "Upload outcome unknown"));
    }
    if (upload.status === 200 || upload.status === 201) {
      const video = videoSchema.safeParse(await readJson(upload));
      return video.success
        ? ok(toPublication(video.data))
        : err(new DomainError("AMBIGUOUS_EXTERNAL_STATE", "Upload answer unreadable"));
    }
    if (upload.status === 404) {
      return err(new DomainError("EXTERNAL_UNAVAILABLE", "Upload session expired"));
    }
    if (upload.status === 308) {
      // Partly received; the retry reconciles (308 = no video) and starts a new session.
      return err(new DomainError("EXTERNAL_UNAVAILABLE", "Upload incomplete"));
    }
    return err(apiError(upload.status, await readJson(upload)));
  }

  async reconcile(
    request: PublishRequest,
    checkpoint?: PlatformCheckpoint | null,
  ): Promise<Result<ReconcileResult, DomainError>> {
    const saved = checkpointSchema.safeParse(checkpoint);
    // No session was ever saved: no byte was sent, so no video can exist.
    if (!saved.success) return ok({ found: false });
    const access = await this.deps.tokens.getAccessToken(request.channelId);
    if (!access.ok) return access;
    const response = await safeFetch(
      this.fetchImpl,
      saved.data.sessionUri,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${access.value.accessToken}`,
          "Content-Range": `bytes */${String(saved.data.sizeBytes)}`,
          "Content-Length": "0",
        },
      },
      this.timeoutMs,
    );
    if (!response || response.status >= 500) {
      return err(new DomainError("EXTERNAL_UNAVAILABLE", "Could not check the upload session"));
    }
    if (response.status === 200 || response.status === 201) {
      const video = videoSchema.safeParse(await readJson(response));
      return video.success
        ? ok({ found: true, publication: toPublication(video.data) })
        : err(new DomainError("EXTERNAL_UNAVAILABLE", "Session answer unreadable"));
    }
    // 308: incomplete (no video was created). 404: session expired before completing.
    if (response.status === 308 || response.status === 404) return ok({ found: false });
    return err(apiError(response.status, await readJson(response)));
  }

  async getStatus(
    externalId: string,
    channelId?: string,
  ): Promise<Result<ExternalPublication, DomainError>> {
    if (!channelId) return err(new DomainError("VALIDATION_FAILED", "channelId is required"));
    const access = await this.deps.tokens.getAccessToken(channelId);
    if (!access.ok) return access;
    const url = `${YOUTUBE_VIDEOS_URL}?part=status&id=${encodeURIComponent(externalId)}`;
    const response = await safeFetch(
      this.fetchImpl,
      url,
      { method: "GET", headers: { Authorization: `Bearer ${access.value.accessToken}` } },
      this.timeoutMs,
    );
    if (!response) return err(new DomainError("EXTERNAL_UNAVAILABLE", "YouTube unreachable"));
    if (!response.ok) return err(apiError(response.status, await readJson(response)));
    const list = listSchema.safeParse(await readJson(response));
    if (!list.success) return err(new DomainError("EXTERNAL_UNAVAILABLE", "Unexpected answer"));
    const video = list.data.items[0];
    return video ? ok(toPublication(video)) : err(new DomainError("NOT_FOUND", "Unknown video"));
  }
}
