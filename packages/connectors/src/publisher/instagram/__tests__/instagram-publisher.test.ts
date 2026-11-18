import { ok } from "@gta6/domain";
import { describe, expect, it } from "vitest";

import { runPublisherContract, sampleRequest } from "../../__tests__/publisher-contract";
import type { PlatformTokenSource } from "../../platform-deps";
import { memoryPublishContext } from "../../publisher-adapter";
import { InstagramPublisher } from "../instagram-publisher";
import { FakeInstagram } from "./fake-instagram";

const tokens: PlatformTokenSource = {
  getAccessToken: () => Promise.resolve(ok({ accessToken: "good-token", accountId: "1784" })),
};
const media = {
  download: () => Promise.resolve(new Uint8Array([1])),
  signedUrl: () => Promise.resolve("https://storage.example.test/signed/master.mp4?token=x"),
};

function setup(publicPostsAuthorized = true) {
  const instagram = new FakeInstagram();
  const adapter = new InstagramPublisher({
    tokens,
    media,
    fetch: instagram.fetch,
    graphVersion: "v99.0",
    publicPostsAuthorized,
    pollIntervalMs: 0,
    sleep: () => Promise.resolve(),
  });
  return { instagram, adapter };
}

// The contract runs with public posts authorized, which only tests may do in Phase 4.
runPublisherContract("InstagramPublisher (fake API)", () => setup().adapter);

describe("InstagramPublisher", () => {
  it("cannot upload privately, so the orchestrator never calls it in Phase 4", () => {
    expect(setup().adapter.capabilities.privateVisibility).toBe(false);
  });

  it("refuses every post without the owner's authorization for public posts", async () => {
    const { instagram, adapter } = setup(false);
    const result = await adapter.publish(sampleRequest());
    expect(!result.ok && result.error.code).toBe("FORBIDDEN");
    expect(instagram.containers.size).toBe(0);
  });

  it("never stores the signed URL in the checkpoint", async () => {
    const { adapter } = setup();
    const context = memoryPublishContext();
    expect((await adapter.publish(sampleRequest(), context)).ok).toBe(true);
    expect(JSON.stringify(context.current())).not.toContain("signed");
  });

  it("a lost publish answer reconciles to the existing Reel: no duplicate", async () => {
    const { instagram, adapter } = setup();
    instagram.faults.push("lose_publish_response");
    const request = sampleRequest();
    const context = memoryPublishContext();
    const first = await adapter.publish(request, context);
    expect(!first.ok && first.error.code).toBe("AMBIGUOUS_EXTERNAL_STATE");
    const reconciled = await adapter.reconcile(request, context.current());
    expect(reconciled.ok && reconciled.value.found).toBe(true);
    expect(instagram.media.size).toBe(1);
  });

  it("a container that failed processing is a validation error and posts nothing", async () => {
    const { instagram, adapter } = setup();
    instagram.faults.push("processing_error");
    const result = await adapter.publish(sampleRequest());
    expect(!result.ok && result.error.code).toBe("VALIDATION_FAILED");
    expect(instagram.media.size).toBe(0);
  });
});
