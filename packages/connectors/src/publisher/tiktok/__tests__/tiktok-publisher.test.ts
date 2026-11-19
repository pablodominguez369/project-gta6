import { ok } from "@gta6/domain";
import { describe, expect, it } from "vitest";

import { runPublisherContract, sampleRequest } from "../../__tests__/publisher-contract";
import type { PlatformTokenSource } from "../../platform-deps";
import { memoryPublishContext } from "../../publisher-adapter";
import { chunkPlan, TikTokPublisher, TIKTOK_CHUNK } from "../tiktok-publisher";
import { FakeTikTok } from "./fake-tiktok";

const small = new Uint8Array(1024).fill(7);
const media = { download: () => Promise.resolve(small) };
const tokens: PlatformTokenSource = {
  getAccessToken: () => Promise.resolve(ok({ accessToken: "good-token", accountId: "open-1" })),
};

function setup(file = small) {
  const tiktok = new FakeTikTok();
  const adapter = new TikTokPublisher({
    tokens,
    media: { download: () => Promise.resolve(file) },
    fetch: tiktok.fetch,
  });
  return { tiktok, adapter };
}

runPublisherContract("TikTokPublisher (fake API)", () => setup().adapter);

describe("chunkPlan", () => {
  it("follows the media transfer rules", () => {
    expect(chunkPlan(1024)).toEqual({ chunkSize: 1024, totalChunks: 1 });
    expect(chunkPlan(25 * 1024 * 1024)).toEqual({ chunkSize: TIKTOK_CHUNK, totalChunks: 2 });
    const last = 25 * 1024 * 1024 - TIKTOK_CHUNK;
    expect(last).toBeLessThanOrEqual(128 * 1024 * 1024);
  });
});

describe("TikTokPublisher", () => {
  it("posts SELF_ONLY with interactions off and the AI label", async () => {
    const { tiktok, adapter } = setup();
    const result = await adapter.publish(sampleRequest({ syntheticMedia: true }));
    expect(result.ok && result.value.status).toBe("published");
    const [post] = [...tiktok.posts.values()];
    expect(post?.postInfo).toMatchObject({
      privacy_level: "SELF_ONLY",
      disable_comment: true,
      disable_duet: true,
      disable_stitch: true,
      brand_content_toggle: false,
      is_aigc: true,
    });
  });

  // ADR 0007: public posts only reach the adapter after every gate; TikTok then needs the level.
  it("posts PUBLIC_TO_EVERYONE when the operator chose public", async () => {
    const { tiktok, adapter } = setup();
    const result = await adapter.publish(sampleRequest({ visibility: "public" }));
    expect(result.ok).toBe(true);
    const [post] = [...tiktok.posts.values()];
    expect(post?.postInfo).toMatchObject({ privacy_level: "PUBLIC_TO_EVERYONE" });
  });

  it("uploads a large file in ordered chunks", async () => {
    const big = new Uint8Array(23 * 1024 * 1024).fill(1);
    const { tiktok, adapter } = setup(big);
    expect((await adapter.publish(sampleRequest())).ok).toBe(true);
    expect(tiktok.completed()).toBe(1);
  });

  it("requires the operator's explicit privacy choice", async () => {
    const { tiktok, adapter } = setup();
    const result = await adapter.publish(sampleRequest({ visibilityConfirmed: false }));
    expect(!result.ok && result.error.code).toBe("VALIDATION_FAILED");
    expect(tiktok.posts.size).toBe(0);
  });

  it("refuses an account that cannot post privately", async () => {
    const { tiktok, adapter } = setup();
    tiktok.faults.push("public_only_account");
    const result = await adapter.publish(sampleRequest());
    expect(!result.ok && result.error.code).toBe("FORBIDDEN");
    expect(tiktok.posts.size).toBe(0);
  });

  it("a lost answer for the last chunk reconciles to the existing post: no duplicate", async () => {
    const { tiktok, adapter } = setup();
    tiktok.faults.push("lose_last_chunk_response");
    const request = sampleRequest();
    const context = memoryPublishContext();
    const first = await adapter.publish(request, context);
    expect(!first.ok && first.error.code).toBe("AMBIGUOUS_EXTERNAL_STATE");
    const reconciled = await adapter.reconcile(request, context.current());
    expect(reconciled.ok && reconciled.value.found).toBe(true);
    expect(tiktok.posts.size).toBe(1);
  });

  it("a post still processing is never reported as not found", async () => {
    const { tiktok, adapter } = setup();
    tiktok.faults.push("stuck_processing");
    const request = sampleRequest();
    const context = memoryPublishContext();
    await adapter.publish(request, context);
    const result = await adapter.reconcile(request, context.current());
    expect(!result.ok && result.error.code).toBe("EXTERNAL_UNAVAILABLE");
  });

  it("maps TikTok limits and invalid tokens", async () => {
    const { tiktok, adapter } = setup();
    tiktok.faults.push("too_many_posts");
    const limited = await adapter.publish(sampleRequest());
    expect(!limited.ok && limited.error.code).toBe("RATE_LIMITED");

    const expired = new TikTokPublisher({
      tokens: {
        getAccessToken: () => Promise.resolve(ok({ accessToken: "bad", accountId: null })),
      },
      media,
      fetch: tiktok.fetch,
    });
    const auth = await expired.publish(sampleRequest());
    expect(!auth.ok && auth.error.code).toBe("CREDENTIAL_EXPIRED");
  });

  it("refuses captions over 2200 characters before any call", async () => {
    const { tiktok, adapter } = setup();
    const result = await adapter.publish(sampleRequest({ description: "x".repeat(2200) }));
    expect(!result.ok && result.error.code).toBe("VALIDATION_FAILED");
    expect(tiktok.posts.size).toBe(0);
  });
});
