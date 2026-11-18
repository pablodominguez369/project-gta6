import { DomainError, err, ok } from "@gta6/domain";
import { describe, expect, it } from "vitest";

import { runPublisherContract, sampleRequest } from "../../__tests__/publisher-contract";
import type { PlatformTokenSource } from "../../platform-deps";
import { memoryPublishContext } from "../../publisher-adapter";
import { YouTubePublisher } from "../youtube-publisher";
import { FakeYouTube } from "./fake-youtube";

const video = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
const media = { download: (path: string) => Promise.resolve(path.endsWith(".mp4") ? video : null) };
const tokens: PlatformTokenSource = {
  getAccessToken: () => Promise.resolve(ok({ accessToken: "good-token", accountId: null })),
};

function setup() {
  const youtube = new FakeYouTube();
  const adapter = new YouTubePublisher({ tokens, media, fetch: youtube.fetch });
  return { youtube, adapter };
}

runPublisherContract("YouTubePublisher (fake API)", () => setup().adapter);

describe("YouTubePublisher", () => {
  it("uploads privately, declares synthetic media and never schedules", async () => {
    const { youtube, adapter } = setup();
    const result = await adapter.publish(sampleRequest({ syntheticMedia: true }));
    expect(result.ok && result.value.permalink).toMatch(/^https:\/\/youtu\.be\/yt/);
    const [session] = [...youtube.sessions.values()];
    expect(session?.metadata).toMatchObject({
      status: {
        privacyStatus: "private",
        selfDeclaredMadeForKids: false,
        containsSyntheticMedia: true,
      },
    });
    expect(JSON.stringify(session?.metadata)).not.toContain("publishAt");
  });

  it("a lost upload response is reconciled from the saved session: one video, no duplicate", async () => {
    const { youtube, adapter } = setup();
    youtube.faults.push("none", "lose_upload_response");
    const request = sampleRequest();
    const context = memoryPublishContext();

    const first = await adapter.publish(request, context);
    expect(!first.ok && first.error.code).toBe("AMBIGUOUS_EXTERNAL_STATE");
    expect(context.current()).toMatchObject({ sizeBytes: video.length });

    const reconciled = await adapter.reconcile(request, context.current());
    expect(reconciled.ok && reconciled.value.found).toBe(true);
    expect(youtube.videos.size).toBe(1);
  });

  it("a dropped connection before the upload reconciles as not found (safe to upload again)", async () => {
    const { youtube, adapter } = setup();
    youtube.faults.push("none", "drop_before_upload");
    const request = sampleRequest();
    const context = memoryPublishContext();
    expect((await adapter.publish(request, context)).ok).toBe(false);
    expect(await adapter.reconcile(request, context.current())).toEqual({
      ok: true,
      value: { found: false },
    });
    expect(youtube.videos.size).toBe(0);
  });

  it("an unreachable session check is an error, never 'not found'", async () => {
    const { youtube, adapter } = setup();
    youtube.faults.push("none", "lose_upload_response", "status_unavailable");
    const request = sampleRequest();
    const context = memoryPublishContext();
    await adapter.publish(request, context);
    const result = await adapter.reconcile(request, context.current());
    expect(!result.ok && result.error.code).toBe("EXTERNAL_UNAVAILABLE");
  });

  it("maps quota and auth errors, and refuses bad metadata before any call", async () => {
    const { youtube, adapter } = setup();
    youtube.faults.push("quota_exceeded");
    const quota = await adapter.publish(sampleRequest());
    expect(!quota.ok && quota.error.code).toBe("RATE_LIMITED");

    const expired = new YouTubePublisher({
      tokens: {
        getAccessToken: () => Promise.resolve(ok({ accessToken: "old", accountId: null })),
      },
      media,
      fetch: youtube.fetch,
    });
    const auth = await expired.publish(sampleRequest());
    expect(!auth.ok && auth.error.code).toBe("CREDENTIAL_EXPIRED");

    const sessionsBefore = youtube.sessions.size;
    const html = await adapter.publish(sampleRequest({ title: "<b>GTA</b>" }));
    expect(!html.ok && html.error.code).toBe("VALIDATION_FAILED");
    const scheduled = await adapter.publish(
      sampleRequest({ scheduledAt: "2026-12-01T10:00:00.000Z" }),
    );
    expect(!scheduled.ok && scheduled.error.code).toBe("VALIDATION_FAILED");
    expect(youtube.sessions.size).toBe(sessionsBefore);
  });

  it("passes a credential error through without calling YouTube", async () => {
    const youtube = new FakeYouTube();
    const adapter = new YouTubePublisher({
      tokens: {
        getAccessToken: () =>
          Promise.resolve(err(new DomainError("CREDENTIAL_EXPIRED", "reconnect"))),
      },
      media,
      fetch: youtube.fetch,
    });
    const result = await adapter.publish(sampleRequest());
    expect(!result.ok && result.error.code).toBe("CREDENTIAL_EXPIRED");
    expect(youtube.sessions.size).toBe(0);
  });
});
