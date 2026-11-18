import { randomUUID } from "node:crypto";

import { SimulatedPublisher, type SimulatedFault } from "@gta6/connectors";
import { createLogger } from "@gta6/observability";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { dropSchema, testDatabaseUrl, uniqueSchema } from "../../__tests__/test-db";
import { QUEUES } from "../../definitions";
import type { EnqueueOptions, JobQueue } from "../../job-queue";
import { PgBossQueue } from "../../pg-boss-queue";
import { dispatchDuePublications } from "../dispatcher";
import { PgSimulatedRemoteStore } from "../pg-simulated-remote-store";
import { processPublication } from "../process-publication";
import { PgPublicationStore } from "../publication-store";
import { createPublishHandler } from "../publish-handler";

const logger = createLogger({ name: "publishing-it", level: "fatal" });
const pool = new pg.Pool({ connectionString: testDatabaseUrl, max: 8 });
const store = new PgPublicationStore(pool);
const remote = new PgSimulatedRemoteStore(pool);

const channelIds: string[] = [];

async function createChannel(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into public.channels (platform, display_name, mode, timezone, max_posts_per_day,
                                  min_minutes_between_posts)
     values ('simulated', 'IT ' || gen_random_uuid(), 'draft', 'Europe/Madrid', 50, 0)
     returning id`,
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("channel not created");
  channelIds.push(id);
  return id;
}

async function createPublication(channelId: string, key = `it-${randomUUID()}`) {
  const { rows } = await pool.query<{ id: string }>(
    `insert into public.publications (channel_id, idempotency_key, payload_json)
     values ($1, $2, $3) returning id`,
    [
      channelId,
      key,
      JSON.stringify({ title: "Prueba", description: "", mediaRef: "simulated://media/it" }),
    ],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("publication not created");
  return { id, key };
}

async function readPublication(id: string) {
  const { rows } = await pool.query<{
    status: string;
    error_code: string | null;
    reconcile_required: boolean;
    external_id: string | null;
  }>(
    "select status, error_code, reconcile_required, external_id from public.publications where id = $1",
    [id],
  );
  return rows[0];
}

async function postsFor(key: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    "select count(*)::int as n from public.simulated_platform_posts where idempotency_key = $1",
    [key],
  );
  return rows[0]?.n ?? 0;
}

function publisher(publish: SimulatedFault[] = [], reconcile: SimulatedFault[] = []) {
  return new SimulatedPublisher({
    store: remote,
    publishFaults: publish,
    reconcileFaults: reconcile,
  });
}

async function setGlobalPause(paused: boolean): Promise<void> {
  await pool.query("update public.system_controls set global_paused = $1, paused_reason = $2", [
    paused,
    paused ? "integration test" : null,
  ]);
}

beforeAll(async () => {
  await setGlobalPause(false);
});

afterEach(async () => {
  await setGlobalPause(false);
});

afterAll(async () => {
  for (const channelId of channelIds) {
    await pool.query(
      `delete from public.simulated_platform_posts where idempotency_key in
         (select idempotency_key from public.publications where channel_id = $1)`,
      [channelId],
    );
    await pool.query("delete from public.publications where channel_id = $1", [channelId]);
    await pool.query("delete from public.channels where id = $1", [channelId]);
  }
  await pool.end();
});

describe("idempotency key", () => {
  it("the same key twice produces a single publication row", async () => {
    const channelId = await createChannel();
    const { key } = await createPublication(channelId);
    await expect(createPublication(channelId, key)).rejects.toMatchObject({ code: "23505" });
    const { rows } = await pool.query<{ n: number }>(
      "select count(*)::int as n from public.publications where idempotency_key = $1",
      [key],
    );
    expect(rows[0]?.n).toBe(1);
  });
});

describe("processPublication against Postgres", () => {
  const run = (id: string, adapter: SimulatedPublisher, attempt: number, maxAttempts = 4) =>
    processPublication(
      { store, publishers: { simulated: adapter }, publishingMode: "simulated", logger },
      { publicationId: id, attempt, maxAttempts },
    );

  it("timeout after accept: reconciles on retry and leaves exactly one simulated post", async () => {
    const { id, key } = await createPublication(await createChannel());
    const adapter = publisher(["timeout_after_accept"]);

    expect((await run(id, adapter, 1)).kind).toBe("retry");
    expect(await readPublication(id)).toMatchObject({
      status: "ambiguous",
      reconcile_required: true,
    });
    expect(await run(id, adapter, 2)).toEqual({ kind: "succeeded", via: "reconcile" });
    expect(await postsFor(key)).toBe(1);
    expect((await readPublication(id))?.external_id).toMatch(/^sim_/);
  });

  it("global pause leaves the publication blocked and nothing reaches the platform", async () => {
    const { id, key } = await createPublication(await createChannel());
    await setGlobalPause(true);
    expect(await run(id, publisher(), 1)).toEqual({ kind: "blocked", code: "SYSTEM_PAUSED" });
    expect(await readPublication(id)).toMatchObject({
      status: "blocked",
      error_code: "SYSTEM_PAUSED",
    });
    expect(await postsFor(key)).toBe(0);
  });

  it("timeout before accept: the retry publishes exactly once", async () => {
    const { id, key } = await createPublication(await createChannel());
    const adapter = publisher(["timeout_before_accept"]);
    expect((await run(id, adapter, 1)).kind).toBe("retry");
    expect(await run(id, adapter, 2)).toEqual({ kind: "succeeded", via: "publish" });
    expect(await postsFor(key)).toBe(1);
  });

  it("an expired credential fails without retry", async () => {
    const { id } = await createPublication(await createChannel());
    expect(await run(id, publisher(["credential_expired"]), 1)).toEqual({
      kind: "failed",
      code: "CREDENTIAL_EXPIRED",
    });
    expect((await readPublication(id))?.status).toBe("failed");
  });

  it("stays ambiguous with an audit event when reconciliation keeps failing", async () => {
    const { id, key } = await createPublication(await createChannel());
    const adapter = publisher(
      ["timeout_after_accept"],
      ["reconcile_unavailable", "reconcile_unavailable"],
    );
    expect((await run(id, adapter, 1, 3)).kind).toBe("retry");
    expect((await run(id, adapter, 2, 3)).kind).toBe("retry");
    expect((await run(id, adapter, 3, 3)).kind).toBe("needs_manual_reconciliation");
    expect((await readPublication(id))?.status).toBe("ambiguous");
    expect(await postsFor(key)).toBe(1);

    const { rows } = await pool.query<{ actor_type: string }>(
      `select actor_type from public.audit_events
        where object_id = $1 and action = 'publications.reconciliation_required'`,
      [id],
    );
    expect(rows).toEqual([{ actor_type: "worker" }]);
  });

  it("serializes attempts per channel with an advisory lock", async () => {
    const channelId = await createChannel();
    const first = await createPublication(channelId);
    const second = await createPublication(channelId);

    let release: () => void = () => undefined;
    const holding = store.withChannelLock(
      channelId,
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const blocked = await run(second.id, publisher(), 1);
    expect(blocked.kind === "retry" && blocked.error.code).toBe("CONFLICT");
    release();
    await holding;

    expect((await run(first.id, publisher(), 1)).kind).toBe("succeeded");
    expect((await run(second.id, publisher(), 1)).kind).toBe("succeeded");
  });
});

describe("dispatcher", () => {
  class RecordingQueue implements Pick<JobQueue, "enqueue"> {
    readonly enqueued: { data: object; options: EnqueueOptions | undefined }[] = [];
    enqueue(_queue: string, data: object, options?: EnqueueOptions): Promise<string | null> {
      this.enqueued.push({ data, options });
      return Promise.resolve(randomUUID());
    }
  }

  const dispatchedIds = async (queue: RecordingQueue) => {
    await dispatchDuePublications(pool, queue as unknown as JobQueue, { batchSize: 10_000 });
    return queue.enqueued.map((entry) => (entry.data as { publicationId: string }).publicationId);
  };

  it("enqueues queued rows with the publication id as singleton key", async () => {
    const { id } = await createPublication(await createChannel());
    const queue = new RecordingQueue();
    expect(await dispatchedIds(queue)).toContain(id);
    expect(queue.enqueued.find((e) => e.options?.singletonKey === id)).toBeDefined();
  });

  it("does not pick blocked rows before next_attempt_at or while paused", async () => {
    const { id } = await createPublication(await createChannel());
    await pool.query(
      `update public.publications set status = 'blocked', error_code = 'SYSTEM_PAUSED',
              next_attempt_at = now() + interval '1 hour' where id = $1`,
      [id],
    );
    expect(await dispatchedIds(new RecordingQueue())).not.toContain(id);

    await pool.query(
      "update public.publications set next_attempt_at = now() - interval '1 second' where id = $1",
      [id],
    );
    await setGlobalPause(true);
    expect(await dispatchedIds(new RecordingQueue())).not.toContain(id);
    await setGlobalPause(false);
    expect(await dispatchedIds(new RecordingQueue())).toContain(id);
  });

  it("never picks ambiguous rows (they need an operator)", async () => {
    const { id } = await createPublication(await createChannel());
    await pool.query(
      "update public.publications set status = 'ambiguous', reconcile_required = true where id = $1",
      [id],
    );
    expect(await dispatchedIds(new RecordingQueue())).not.toContain(id);
  });
});

describe("end to end through pg-boss", () => {
  const schema = uniqueSchema();
  let queue: PgBossQueue | undefined;

  afterAll(async () => {
    await queue?.stop({ timeoutMs: 5_000 });
    await dropSchema(schema);
  });

  it("a lost response is retried by the queue, reconciled, and published once", async () => {
    const { id, key } = await createPublication(await createChannel());
    queue = new PgBossQueue({ connectionString: testDatabaseUrl, schema });
    await queue.start();
    // Same policy as production, faster retries for the test.
    const definition = { ...QUEUES.publishSimulated, retryDelaySeconds: 1 };
    await queue.ensureQueue(definition);

    const attempts: number[] = [];
    const handler = createPublishHandler(
      {
        store,
        publishers: { simulated: publisher(["timeout_after_accept"]) },
        publishingMode: "simulated",
      },
      definition,
    );
    await queue.work(
      definition.name,
      async (job) => {
        attempts.push(job.attempt);
        await handler(job, { logger, jobRunId: null });
      },
      { pollingIntervalSeconds: 0.5 },
    );

    expect(
      await queue.enqueue(definition.name, { publicationId: id }, { singletonKey: id }),
    ).not.toBeNull();
    // A second enqueue while the first job is pending is deduplicated by the exclusive policy.
    expect(
      await queue.enqueue(definition.name, { publicationId: id }, { singletonKey: id }),
    ).toBeNull();

    let status: string | undefined;
    for (let i = 0; i < 300 && status !== "succeeded"; i += 1) {
      status = (await readPublication(id))?.status;
      if (status !== "succeeded") await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(status).toBe("succeeded");
    expect(attempts).toEqual([1, 2]);
    expect(await postsFor(key)).toBe(1);
  });
});

describe("PgPublicationStore checkpoints (T29/T32)", () => {
  it("persists the adapter checkpoint and clears it once the post exists", async () => {
    const channelId = await createChannel();
    const { id } = await createPublication(channelId);
    await store.saveCheckpoint(id, {
      sessionUri: "https://www.googleapis.com/upload/x",
      sizeBytes: 9,
    });
    const context = await store.loadContext(id);
    expect(context?.publication.platformCheckpoint).toEqual({
      sessionUri: "https://www.googleapis.com/upload/x",
      sizeBytes: 9,
    });
    expect(context?.channel).toMatchObject({
      mode: "draft",
      liveUploadsEnabled: false,
      credentialActive: false,
    });

    await store.markSucceeded(
      id,
      { externalId: "yt1", permalink: null, status: "processing" },
      new Date(),
    );
    const { rows } = await pool.query<{ platform_checkpoint: unknown }>(
      "select platform_checkpoint from public.publications where id = $1",
      [id],
    );
    expect(rows[0]?.platform_checkpoint).toBeNull();
  });
});
