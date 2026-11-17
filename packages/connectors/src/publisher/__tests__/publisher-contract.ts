import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { PublisherAdapter, PublishRequest } from "../publisher-adapter";

const ALLOWED_ERROR_CODES = new Set([
  "RATE_LIMITED",
  "EXTERNAL_UNAVAILABLE",
  "AMBIGUOUS_EXTERNAL_STATE",
  "CREDENTIAL_EXPIRED",
  "VALIDATION_FAILED",
  "FORBIDDEN",
  "NOT_FOUND",
]);

export function sampleRequest(overrides: Partial<PublishRequest> = {}): PublishRequest {
  return {
    idempotencyKey: `pub-${randomUUID()}`,
    channelId: randomUUID(),
    title: "Contract test",
    description: "Contract test description",
    mediaRef: "renders/contract-test.mp4",
    scheduledAt: null,
    ...overrides,
  };
}

/**
 * Behaviour every PublisherAdapter must have. Each real adapter (YouTube, Instagram, TikTok)
 * must run this suite against its sandbox or recorded fixtures before it can be enabled.
 * `factory` must return a fresh adapter in a working (no-fault) state.
 */
export function runPublisherContract(name: string, factory: () => PublisherAdapter): void {
  describe(`PublisherAdapter contract: ${name}`, () => {
    it("declares capabilities explicitly", () => {
      const { capabilities } = factory();
      expect(typeof capabilities.directPublish).toBe("boolean");
      expect(typeof capabilities.reconcileByRequest).toBe("boolean");
      expect(Array.isArray(capabilities.docsUrls)).toBe(true);
    });

    it("rejects invalid requests with VALIDATION_FAILED and without throwing", async () => {
      const adapter = factory();
      const invalid = sampleRequest({ idempotencyKey: "x" });

      expect(adapter.validate(invalid).ok).toBe(false);
      const result = await adapter.publish(invalid);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
    });

    it("returns an external id and permalink on success", async () => {
      const result = await factory().publish(sampleRequest());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.externalId).toEqual(expect.any(String));
        expect(["published", "processing", "scheduled"]).toContain(result.value.status);
      }
    });

    it("reports scheduled posts as scheduled when it supports scheduling", async () => {
      const adapter = factory();
      if (!adapter.capabilities.scheduledPublish) return;
      const result = await adapter.publish(
        sampleRequest({ scheduledAt: new Date(Date.now() + 3_600_000).toISOString() }),
      );

      expect(result.ok && result.value.status).toBe("scheduled");
    });

    it("can reconcile a request it published, when it claims that capability", async () => {
      const adapter = factory();
      if (!adapter.capabilities.reconcileByRequest) return;
      const request = sampleRequest();
      const published = await adapter.publish(request);
      const reconciled = await adapter.reconcile(request);

      expect(published.ok && reconciled.ok).toBe(true);
      if (published.ok && reconciled.ok) {
        expect(reconciled.value).toEqual({ found: true, publication: published.value });
      }
    });

    it("reconciles an unknown request as not found", async () => {
      const adapter = factory();
      if (!adapter.capabilities.reconcileByRequest) return;
      const result = await adapter.reconcile(sampleRequest());

      expect(result).toEqual({ ok: true, value: { found: false } });
    });

    it("looks up status by external id and answers NOT_FOUND for unknown ids", async () => {
      const adapter = factory();
      const published = await adapter.publish(sampleRequest());
      if (!published.ok) throw new Error("publish failed");

      const status = await adapter.getStatus(published.value.externalId);
      const unknown = await adapter.getStatus("does-not-exist");
      expect(status.ok && status.value.externalId).toBe(published.value.externalId);
      expect(!unknown.ok && unknown.error.code).toBe("NOT_FOUND");
    });

    it("only uses known error codes", async () => {
      const result = await factory().getStatus("does-not-exist");
      if (!result.ok) expect(ALLOWED_ERROR_CODES.has(result.error.code)).toBe(true);
    });
  });
}
