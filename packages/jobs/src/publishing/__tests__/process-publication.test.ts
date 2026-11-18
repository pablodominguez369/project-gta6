import {
  InMemorySimulatedRemoteStore,
  SIMULATED_CAPABILITIES,
  SimulatedPublisher,
  type ExternalPublication,
  type PlatformCheckpoint,
  type PublishContext,
  type PublisherAdapter,
  type PublisherCapabilities,
  type PublishRequest,
  type ReconcileResult,
  type SimulatedFault,
} from "@gta6/connectors";
import { DomainError, err, ok, type Result } from "@gta6/domain";
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
      {
        store,
        publishers: { simulated: publisher },
        publishingMode: "simulated",
        logger,
        now: () => NOW,
      },
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

/** A real-platform stand-in that loses the response after saving a checkpoint. */
class CheckpointingFakeAdapter implements PublisherAdapter {
  readonly platform = "youtube" as const;
  readonly capabilities: PublisherCapabilities;
  readonly uploads: string[] = [];
  reconciledWith: PlatformCheckpoint | null | undefined;
  private loseNextResponse: boolean;

  constructor(options: { privateVisibility?: boolean; loseFirstResponse?: boolean } = {}) {
    this.capabilities = {
      ...SIMULATED_CAPABILITIES,
      privateVisibility: options.privateVisibility ?? true,
    };
    this.loseNextResponse = options.loseFirstResponse ?? false;
  }

  validate(request: PublishRequest): Result<PublishRequest, DomainError> {
    return ok(request);
  }

  async publish(
    request: PublishRequest,
    context?: PublishContext,
  ): Promise<Result<ExternalPublication, DomainError>> {
    await context?.saveCheckpoint({ uploadId: `up-${request.idempotencyKey}` });
    this.uploads.push(request.idempotencyKey);
    if (this.loseNextResponse) {
      this.loseNextResponse = false;
      return err(new DomainError("AMBIGUOUS_EXTERNAL_STATE", "lost"));
    }
    return ok({ externalId: "yt_1", permalink: null, status: "processing" });
  }

  reconcile(
    _request: PublishRequest,
    checkpoint?: PlatformCheckpoint | null,
  ): Promise<Result<ReconcileResult, DomainError>> {
    this.reconciledWith = checkpoint;
    return Promise.resolve(
      ok(
        checkpoint
          ? {
              found: true,
              publication: { externalId: "yt_1", permalink: null, status: "processing" },
            }
          : { found: false },
      ),
    );
  }

  getStatus(): Promise<Result<ExternalPublication, DomainError>> {
    return Promise.resolve(err(new DomainError("NOT_FOUND", "unknown")));
  }
}

describe("processPublication on real platforms (ADR 0005)", () => {
  function liveSetup(
    adapter: CheckpointingFakeAdapter,
    publishingMode: "simulated" | "live" = "live",
  ) {
    const store = new MemoryPublicationStore();
    store.platform = "youtube";
    store.liveUploadsEnabled = true;
    store.credentialActive = true;
    store.media = cleanMedia();
    store.payload = {
      title: "Título",
      description: "",
      mediaRef: "renders/x/master.mp4",
      syntheticMedia: true,
    };
    const run = (attempt: number) =>
      processPublication(
        { store, publishers: { youtube: adapter }, publishingMode, logger, now: () => NOW },
        { publicationId: store.id, attempt, maxAttempts: 4 },
      );
    return { store, run };
  }

  it("never calls a real adapter while the worker is simulated", async () => {
    const adapter = new CheckpointingFakeAdapter();
    const { store, run } = liveSetup(adapter, "simulated");
    expect(await run(1)).toEqual({ kind: "failed", code: "FORBIDDEN" });
    expect(adapter.uploads).toEqual([]);
    expect(store.row.status).toBe("failed");
  });

  it("refuses without the channel switch or an active credential", async () => {
    const off = new CheckpointingFakeAdapter();
    const offSetup = liveSetup(off);
    offSetup.store.liveUploadsEnabled = false;
    expect(await offSetup.run(1)).toEqual({ kind: "failed", code: "FORBIDDEN" });

    const noCredential = new CheckpointingFakeAdapter();
    const noCredentialSetup = liveSetup(noCredential);
    noCredentialSetup.store.credentialActive = false;
    expect(await noCredentialSetup.run(1)).toEqual({ kind: "failed", code: "CREDENTIAL_EXPIRED" });
    expect([...off.uploads, ...noCredential.uploads]).toEqual([]);
  });

  it("refuses a platform without an adapter", async () => {
    const { store } = liveSetup(new CheckpointingFakeAdapter());
    store.platform = "tiktok";
    const outcome = await processPublication(
      { store, publishers: {}, publishingMode: "live", logger, now: () => NOW },
      { publicationId: store.id, attempt: 1, maxAttempts: 4 },
    );
    expect(outcome).toEqual({ kind: "failed", code: "FORBIDDEN" });
    expect(store.audit.map((event) => event.action)).toEqual(["publications.platform_refused"]);
  });

  it("refuses an adapter that cannot upload privately (no public posts in Phase 4)", async () => {
    const adapter = new CheckpointingFakeAdapter({ privateVisibility: false });
    const { run } = liveSetup(adapter);
    expect(await run(1)).toEqual({ kind: "failed", code: "FORBIDDEN" });
    expect(adapter.uploads).toEqual([]);
  });

  it("saves the checkpoint and reconciles with it after a lost response", async () => {
    const adapter = new CheckpointingFakeAdapter({ loseFirstResponse: true });
    const { store, run } = liveSetup(adapter);
    expect((await run(1)).kind).toBe("retry");
    expect(store.checkpoint).toEqual({ uploadId: `up-key-${store.id}` });

    expect(await run(2)).toEqual({ kind: "succeeded", via: "reconcile" });
    expect(adapter.reconciledWith).toEqual({ uploadId: `up-key-${store.id}` });
    expect(adapter.uploads).toHaveLength(1);
  });
});
