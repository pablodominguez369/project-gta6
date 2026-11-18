import type { FetchLike } from "../../../discovery/feed-discovery-provider";
import {
  TIKTOK_CREATOR_INFO_URL,
  TIKTOK_STATUS_URL,
  TIKTOK_VIDEO_INIT_URL,
} from "../tiktok-publisher";

export type FakeTikTokFault =
  | "none"
  /** The last chunk arrives and the post is created, but the answer is lost. */
  | "lose_last_chunk_response"
  | "stuck_processing"
  | "public_only_account"
  | "too_many_posts";

interface Post {
  readonly postInfo: Record<string, unknown>;
  readonly size: number;
  received: number;
  status: string;
}

const UPLOAD_BASE = "https://open-upload.tiktokapis.com/upload/";

/** In-memory Content Posting API: creator info, init, chunk upload and status. */
export class FakeTikTok {
  readonly posts = new Map<string, Post>();
  readonly faults: FakeTikTokFault[] = [];
  private counter = 0;

  readonly fetch: FetchLike = (url, init) => this.handle(url, init);

  completed(): number {
    return [...this.posts.values()].filter((post) => post.status === "PUBLISH_COMPLETE").length;
  }

  private handle(url: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    if (url.startsWith(UPLOAD_BASE)) return Promise.resolve(this.upload(url, headers, init));
    if (headers.get("authorization") !== "Bearer good-token") {
      return Promise.resolve(reply(401, null, "access_token_invalid"));
    }
    const body = JSON.parse(typeof init.body === "string" ? init.body : "{}") as Record<
      string,
      unknown
    >;
    if (url === TIKTOK_CREATOR_INFO_URL) {
      const options =
        this.faults[0] === "public_only_account"
          ? (this.faults.shift(), ["PUBLIC_TO_EVERYONE"])
          : ["SELF_ONLY", "PUBLIC_TO_EVERYONE"];
      return Promise.resolve(
        reply(200, { privacy_level_options: options, creator_nickname: "creador" }),
      );
    }
    if (url === TIKTOK_VIDEO_INIT_URL) {
      if (this.faults[0] === "too_many_posts") {
        this.faults.shift();
        return Promise.resolve(reply(403, null, "spam_risk_too_many_posts"));
      }
      const id = `v_pub_${String(++this.counter)}`;
      const source = body.source_info as { video_size: number };
      this.posts.set(id, {
        postInfo: body.post_info as Record<string, unknown>,
        size: source.video_size,
        received: 0,
        status: "PROCESSING_UPLOAD",
      });
      return Promise.resolve(reply(200, { publish_id: id, upload_url: `${UPLOAD_BASE}${id}` }));
    }
    if (url === TIKTOK_STATUS_URL) {
      const post = this.posts.get(String(body.publish_id));
      if (!post) return Promise.resolve(reply(400, null, "invalid_publish_id"));
      return Promise.resolve(reply(200, { status: post.status }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  }

  private upload(url: string, headers: Headers, init: RequestInit): Response | Promise<never> {
    const post = this.posts.get(url.slice(UPLOAD_BASE.length));
    if (!post) return new Response(null, { status: 404 });
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(headers.get("content-range") ?? "");
    const body = init.body instanceof Uint8Array ? init.body : new Uint8Array();
    if (
      !range ||
      Number(range[1]) !== post.received ||
      body.length !== Number(range[2]) - Number(range[1]) + 1
    ) {
      return new Response(null, { status: 400 });
    }
    post.received += body.length;
    if (post.received < post.size) return new Response(null, { status: 206 });
    const fault = this.faults.shift() ?? "none";
    post.status = fault === "stuck_processing" ? "PROCESSING_UPLOAD" : "PUBLISH_COMPLETE";
    if (fault === "lose_last_chunk_response") return Promise.reject(new Error("socket hang up"));
    return new Response(null, { status: 201 });
  }
}

function reply(status: number, data: unknown, code = "ok"): Response {
  return new Response(JSON.stringify({ data: data ?? {}, error: { code, message: "" } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
