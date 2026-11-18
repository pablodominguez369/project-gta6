import type { DomainError, Result } from "@gta6/domain";

import type { FetchLike } from "../discovery/feed-discovery-provider";

/** A valid access token for the channel (refreshed by the worker when needed). Never logged. */
export interface PlatformAccess {
  readonly accessToken: string;
  /** The platform's id for the account (TikTok open_id), when known. */
  readonly accountId: string | null;
}

export interface PlatformTokenSource {
  getAccessToken(channelId: string): Promise<Result<PlatformAccess, DomainError>>;
}

/** Our private media bucket (the render's master MP4). Same shape as the worker's MediaStore. */
export interface PublisherMediaSource {
  download(path: string): Promise<Uint8Array | null>;
}

export interface PlatformPublisherDeps {
  readonly tokens: PlatformTokenSource;
  readonly media: PublisherMediaSource;
  /** Injected so tests use a fake platform; nothing reaches the network in tests. */
  readonly fetch?: FetchLike;
  /** Per-request timeout for metadata calls; uploads get `uploadTimeoutMs`. */
  readonly timeoutMs?: number;
  readonly uploadTimeoutMs?: number;
}

/** Largest file an adapter loads in memory (the master render is far below this). */
export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

/** Fetch that never throws: network errors and timeouts become `null`. */
export async function safeFetch(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response | null> {
  try {
    return await fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
  } catch {
    return null;
  }
}

export async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}
