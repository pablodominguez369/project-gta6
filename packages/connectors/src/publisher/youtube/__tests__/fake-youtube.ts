import type { FetchLike } from "../../../discovery/feed-discovery-provider";
import { YOUTUBE_UPLOAD_URL, YOUTUBE_VIDEOS_URL } from "../youtube-publisher";

export type FakeYouTubeFault =
  | "none"
  /** The video is created, then the connection drops before the answer arrives. */
  | "lose_upload_response"
  /** The connection drops before YouTube receives the file. */
  | "drop_before_upload"
  | "quota_exceeded"
  | "unauthorized"
  | "status_unavailable";

interface Session {
  readonly metadata: unknown;
  readonly size: number;
  videoId: string | null;
}

/** In-memory YouTube Data API: resumable sessions, uploads, status checks and videos.list. */
export class FakeYouTube {
  readonly sessions = new Map<string, Session>();
  readonly videos = new Map<string, { metadata: unknown }>();
  readonly faults: FakeYouTubeFault[] = [];
  private counter = 0;

  readonly fetch: FetchLike = (url, init) => this.handle(url, init);

  private fault(): FakeYouTubeFault {
    return this.faults.shift() ?? "none";
  }

  private handle(url: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    if (headers.get("authorization") !== "Bearer good-token") {
      return Promise.resolve(json(401, { error: { errors: [{ reason: "authError" }] } }));
    }
    if (url === YOUTUBE_UPLOAD_URL && init.method === "POST") {
      const fault = this.fault();
      if (fault === "quota_exceeded") {
        return Promise.resolve(json(403, { error: { errors: [{ reason: "quotaExceeded" }] } }));
      }
      const id = `up${String(++this.counter)}`;
      this.sessions.set(id, {
        metadata: JSON.parse(typeof init.body === "string" ? init.body : "null") as unknown,
        size: Number(headers.get("x-upload-content-length")),
        videoId: null,
      });
      return Promise.resolve(
        new Response(null, {
          status: 200,
          headers: { Location: `${YOUTUBE_UPLOAD_URL}&upload_id=${id}` },
        }),
      );
    }
    const uploadId = new URL(url).searchParams.get("upload_id");
    const session = uploadId ? this.sessions.get(uploadId) : undefined;
    if (url.startsWith(YOUTUBE_UPLOAD_URL) && init.method === "PUT") {
      if (!session) return Promise.resolve(new Response(null, { status: 404 }));
      if (headers.get("content-range")?.startsWith("bytes */")) {
        if (this.fault() === "status_unavailable") {
          return Promise.resolve(new Response(null, { status: 503 }));
        }
        return Promise.resolve(
          session.videoId
            ? json(201, this.resource(session.videoId))
            : new Response(null, { status: 308 }),
        );
      }
      const fault = this.fault();
      if (fault === "drop_before_upload") return Promise.reject(new Error("ECONNRESET"));
      const videoId = `yt${String(++this.counter)}`;
      this.videos.set(videoId, { metadata: session.metadata });
      session.videoId = videoId;
      if (fault === "lose_upload_response") return Promise.reject(new Error("socket hang up"));
      return Promise.resolve(json(201, this.resource(videoId)));
    }
    if (url.startsWith(YOUTUBE_VIDEOS_URL) && init.method === "GET") {
      const id = new URL(url).searchParams.get("id") ?? "";
      return Promise.resolve(json(200, { items: this.videos.has(id) ? [this.resource(id)] : [] }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  }

  private resource(id: string): unknown {
    return { id, status: { uploadStatus: "uploaded", privacyStatus: "private" } };
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
