import type { FetchLike } from "../../../discovery/feed-discovery-provider";
import { INSTAGRAM_GRAPH_HOST } from "../instagram-publisher";

export type FakeInstagramFault = "none" | "lose_publish_response" | "processing_error";

interface Container {
  readonly caption: string;
  readonly videoUrl: string;
  status: string;
  mediaId: string | null;
}

/** In-memory Instagram Graph API (Instagram Login): containers, status, publish, media. */
export class FakeInstagram {
  readonly containers = new Map<string, Container>();
  readonly media = new Map<string, { caption: string }>();
  readonly faults: FakeInstagramFault[] = [];
  private counter = 0;

  constructor(private readonly version = "v99.0") {}

  readonly fetch: FetchLike = (url, init) => Promise.resolve(this.handle(url, init));

  private handle(url: string, init: RequestInit): Response | Promise<never> {
    if (new Headers(init.headers).get("authorization") !== "Bearer good-token") {
      return json(401, { error: { code: 190 } });
    }
    const parsed = new URL(url);
    const prefix = `/${this.version}/`;
    if (parsed.origin !== INSTAGRAM_GRAPH_HOST || !parsed.pathname.startsWith(prefix)) {
      return json(404, { error: { code: 803 } });
    }
    const parts = parsed.pathname.slice(prefix.length).split("/");
    const body = JSON.parse(typeof init.body === "string" ? init.body : "{}") as Record<
      string,
      string
    >;
    if (init.method === "POST" && parts[1] === "media") {
      const id = `c${String(++this.counter)}`;
      const fault =
        this.faults[0] === "processing_error" ? (this.faults.shift(), "ERROR") : "FINISHED";
      this.containers.set(id, {
        caption: body.caption ?? "",
        videoUrl: body.video_url ?? "",
        status: fault,
        mediaId: null,
      });
      return json(200, { id });
    }
    if (init.method === "POST" && parts[1] === "media_publish") {
      const container = this.containers.get(body.creation_id ?? "");
      if (container?.status !== "FINISHED") return json(400, { error: { code: 9007 } });
      const mediaId = `1${String(++this.counter)}`;
      container.status = "PUBLISHED";
      container.mediaId = mediaId;
      this.media.set(mediaId, { caption: container.caption });
      if (this.faults[0] === "lose_publish_response") {
        this.faults.shift();
        return Promise.reject(new Error("socket hang up"));
      }
      return json(200, { id: mediaId });
    }
    if (init.method === "GET" && parts.length === 2 && parts[1] === "media") {
      return json(200, {
        data: [...this.media.entries()].map(([id, item]) => ({
          id,
          caption: item.caption,
          permalink: `https://www.instagram.com/reel/${id}/`,
        })),
      });
    }
    if (init.method === "GET" && parts.length === 1) {
      const id = parts[0] ?? "";
      const container = this.containers.get(id);
      if (container) return json(200, { status_code: container.status });
      if (this.media.has(id)) {
        return json(200, { id, permalink: `https://www.instagram.com/reel/${id}/` });
      }
      return json(400, { error: { code: 100 } });
    }
    return json(404, { error: { code: 803 } });
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
