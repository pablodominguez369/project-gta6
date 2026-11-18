import {
  InMemorySimulatedRemoteStore,
  SimulatedPublisher,
  type SimulatedFault,
} from "@gta6/connectors";
import { createLogger } from "@gta6/observability";
import { describe, expect, it } from "vitest";

import {
  PAUSE_RECHECK_MS,
  processPublication,
  RATE_LIMIT_RECHECK_MS,
  type PublicationOutcome,
} from "../process-publication";
import { MemoryPublicationStore } from "./memory-publication-store";

const logger = createLogger({ name: "test", level: "fatal" });
const NOW = new Date("2026-11-17T12:00:00Z");

function setup(faults: { publish?: SimulatedFault[]; reconcile?: SimulatedFault[] } = {}) {
  const store = new MemoryPublicationStore();
  const remote = new InMemorySimulatedRemoteStore();
  const publisher = new SimulatedPublisher({
    store: remote,
    publishFaults: faults.publish ?? [],
    reconcileFaults: faults.reconcile ?? [],
  });
  const run = (attempt: number, maxAttempts = 4): Promise<PublicationOutcome> =>
    processPublication(
      { store, publisher, logger, now: () => NOW },
      { publicationId: store.id, attempt, maxAttempts },
    );
  return { store, remote, run };
}

describe("processPublication", () => {
  it("publishes once on the happy path", async () => {
    const { store, remote, run } = setup();
    expect(await run(1)).toEqual({ kind: "succeeded", via: "publish" });
    expect(store.row.status).toBe("succeeded");
    expect(store.row.externalId).toMatch(/^sim_/);
    expect(await remote.count()).toBe(1);
  });

  it("timeout after accept: the retry reconciles and does not duplicate", async () => {
    const { store, remote, run } = setup({ publish: ["timeout_after_accept"] });
    const first = await run(1);
    expect(first.kind).toBe("retry");
    expect(store.row).toMatchObject({ status: "ambiguous", reconcileRequired: true });

    expect(await run(2)).toEqual({ kind: "succeeded", via: "reconcile" });
    expect(await remote.count()).toBe(1);
    expect(store.audit.map((event) => event.action)).toEqual(["publications.reconciled"]);
  });

  it("timeout before accept: the retry finds nothing and publishes exactly once", async () => {
    const { store, remote, run } = setup({ publish: ["timeout_before_accept"] });
    expect((await run(1)).kind).toBe("retry");
    expect(await remote.count()).toBe(0);
    expect(await run(2)).toEqual({ kind: "succeeded", via: "publish" });
    expect(await remote.count()).toBe(1);
    expect(store.row.status).toBe("succeeded");
  });

  it("running again after success is a no-op", async () => {
    const { remote, run } = setup();
    await run(1);
    expect(await run(1)).toEqual({ kind: "skipped", reason: "terminal" });
    expect(await remote.count()).toBe(1);
  });

  it("global pause blocks without calling the platform", async () => {
    const { store, remote, run } = setup();
    store.systemPaused = true;
    expect(await run(1)).toEqual({ kind: "blocked", code: "SYSTEM_PAUSED" });
    expect(store.row.status).toBe("blocked");
    expect(store.row.nextAttemptAt).toEqual(new Date(NOW.getTime() + PAUSE_RECHECK_MS));
    expect(await remote.count()).toBe(0);
  });

  it("channel pause blocks; resuming publishes", async () => {
    const { store, remote, run } = setup();
    store.channelPaused = true;
    expect(await run(1)).toEqual({ kind: "blocked", code: "CHANNEL_PAUSED" });
    store.channelPaused = false;
    expect((await run(1)).kind).toBe("succeeded");
    expect(await remote.count()).toBe(1);
  });

  it("a pause during an ambiguous state keeps reconcile_required, so resuming reconciles", async () => {
    const { store, remote, run } = setup({ publish: ["timeout_after_accept"] });
    await run(1);
    store.systemPaused = true;
    expect(await run(2)).toEqual({ kind: "blocked", code: "SYSTEM_PAUSED" });
    expect(store.row.reconcileRequired).toBe(true);
    store.systemPaused = false;
    expect(await run(1)).toEqual({ kind: "succeeded", via: "reconcile" });
    expect(await remote.count()).toBe(1);
  });

  it("frequency limit blocks and re-checks later", async () => {
    const { store, remote, run } = setup();
    store.recentPublishedAt = [1, 2, 3, 4, 5].map((h) => new Date(NOW.getTime() - h * 60_000));
    expect(await run(1)).toEqual({ kind: "blocked", code: "RATE_LIMITED" });
    expect(store.row.nextAttemptAt).toEqual(new Date(NOW.getTime() + RATE_LIMIT_RECHECK_MS));
    expect(await remote.count()).toBe(0);
  });

  it("refuses any real platform in Phase 1", async () => {
    const { store, run } = setup();
    store.platform = "youtube";
    expect(await run(1)).toEqual({ kind: "failed", code: "FORBIDDEN" });
  });

  it("an invalid payload fails without calling the platform", async () => {
    const { store, remote, run } = setup();
    store.payload = { title: "" };
    expect(await run(1)).toEqual({ kind: "failed", code: "VALIDATION_FAILED" });
    expect(await remote.count()).toBe(0);
  });

  it("an expired credential fails and is not retried", async () => {
    const { store, run } = setup({ publish: ["credential_expired"] });
    expect(await run(1)).toEqual({ kind: "failed", code: "CREDENTIAL_EXPIRED" });
    expect(store.row.status).toBe("failed");
  });

  it("transient platform errors retry, and fail on the last attempt", async () => {
    const { store, run } = setup({ publish: ["unavailable", "rate_limited"] });
    expect((await run(1, 2)).kind).toBe("retry");
    expect(await run(2, 2)).toEqual({ kind: "failed", code: "RATE_LIMITED" });
    expect(store.row.status).toBe("failed");
  });

  it("stays ambiguous and asks for manual reconciliation when retries run out", async () => {
    const { store, remote, run } = setup({
      publish: ["timeout_after_accept"],
      reconcile: ["reconcile_unavailable", "reconcile_unavailable", "reconcile_unavailable"],
    });
    expect((await run(1)).kind).toBe("retry");
    expect((await run(2)).kind).toBe("retry");
    expect((await run(3)).kind).toBe("retry");
    expect(await run(4)).toEqual({
      kind: "needs_manual_reconciliation",
      code: "AMBIGUOUS_EXTERNAL_STATE",
    });
    expect(store.row.status).toBe("ambiguous");
    expect(store.audit.at(-1)?.action).toBe("publications.reconciliation_required");
    expect(await remote.count()).toBe(1);
  });

  it("asks for a retry when the channel is busy", async () => {
    const { store, run } = setup();
    store.locked = true;
    const outcome = await run(1);
    expect(outcome.kind === "retry" && outcome.error.code).toBe("CONFLICT");
    expect(store.row.status).toBe("queued");
  });

  it("publishes a render whose rights, voice and QC are still valid", async () => {
    const { store, remote, run } = setup();
    store.media = cleanMedia();
    store.payload = { ...(store.payload as object), syntheticMedia: true };
    expect(await run(1)).toEqual({ kind: "succeeded", via: "publish" });
    expect(await remote.count()).toBe(1);
  });

  it("blocks a render whose asset rights changed, without calling the platform", async () => {
    const { store, remote, run } = setup();
    store.media = {
      ...cleanMedia(),
      assets: [{ id: "a1", origin: "original_work", rightsStatus: "disputed", license: null }],
    };
    store.payload = { ...(store.payload as object), syntheticMedia: true };
    expect(await run(1)).toEqual({ kind: "failed", code: "RIGHTS_BLOCKED" });
    expect(store.row.status).toBe("failed");
    expect(store.audit.at(-1)?.action).toBe("publications.rights_blocked");
    expect(await remote.count()).toBe(0);
  });

  it("blocks a synthetic voice that the publication does not declare", async () => {
    const { store, remote, run } = setup();
    store.media = cleanMedia();
    expect(await run(1)).toEqual({ kind: "failed", code: "RIGHTS_BLOCKED" });
    expect(await remote.count()).toBe(0);
  });

  it("reconciles before the media gate, so an existing post is never hidden", async () => {
    const { store, run } = setup({ publish: ["timeout_after_accept"] });
    store.media = cleanMedia();
    store.payload = { ...(store.payload as object), syntheticMedia: true };
    await run(1);
    store.media = { ...cleanMedia(), qcPassed: false };
    expect(await run(2)).toEqual({ kind: "succeeded", via: "reconcile" });
  });
});

function cleanMedia(): NonNullable<MemoryPublicationStore["media"]> {
  return {
    renderId: "r1",
    qcPassed: true,
    disclosureRequired: true,
    assets: [{ id: "a1", origin: "original_work", rightsStatus: "original", license: null }],
    missingAssetIds: [],
    voice: {
      id: "v1",
      provider: "fake",
      approved: true,
      revoked: false,
      imitatesRealPerson: false,
      hasConsentProof: false,
      license: null,
    },
  };
}
