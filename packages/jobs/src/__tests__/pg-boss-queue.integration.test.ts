import { afterEach, describe, expect, it } from "vitest";

import type { QueueDefinition, QueuedJob } from "../job-queue";
import { PgBossQueue } from "../pg-boss-queue";

import { dropSchema, testDatabaseUrl, uniqueSchema, waitFor } from "./test-db";

const queue: QueueDefinition = {
  name: "test.jobs",
  policy: "standard",
  retryLimit: 2,
  retryDelaySeconds: 1,
  expireInSeconds: 30,
};

const fast = { pollingIntervalSeconds: 0.5 };
const schemas: string[] = [];
const open: PgBossQueue[] = [];

async function newQueue(schema: string): Promise<PgBossQueue> {
  const instance = new PgBossQueue({ connectionString: testDatabaseUrl, schema });
  await instance.start();
  await instance.ensureQueue(queue);
  open.push(instance);
  return instance;
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((instance) => instance.stop({ timeoutMs: 5_000 })));
  await Promise.all(schemas.splice(0).map(dropSchema));
});

describe("PgBossQueue", () => {
  it("keeps a job across a worker restart and processes it exactly once", async () => {
    const schema = uniqueSchema();
    schemas.push(schema);

    // Producer enqueues while no worker is running, then goes away.
    const producer = await newQueue(schema);
    const jobId = await producer.enqueue(queue.name, { value: 42 });
    expect(jobId).toEqual(expect.any(String));
    await producer.stop();
    open.splice(open.indexOf(producer), 1);

    // A fresh process picks it up.
    const processed: QueuedJob<{ value: number }>[] = [];
    const worker = await newQueue(schema);
    await worker.work<{ value: number }>(
      queue.name,
      (job) => {
        processed.push(job);
        return Promise.resolve();
      },
      fast,
    );

    await waitFor(() => processed.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    expect(processed).toHaveLength(1);
    expect(processed[0]).toMatchObject({ id: jobId, data: { value: 42 }, attempt: 1 });
  });

  it("delivers each job to one worker when several compete", async () => {
    const schema = uniqueSchema();
    schemas.push(schema);
    const producer = await newQueue(schema);
    const ids = await Promise.all(
      Array.from({ length: 20 }, (_, index) => producer.enqueue(queue.name, { index })),
    );

    const seen: string[] = [];
    const workers = await Promise.all([newQueue(schema), newQueue(schema), newQueue(schema)]);
    await Promise.all(
      workers.map((worker) =>
        worker.work(
          queue.name,
          (job) => {
            seen.push(job.id);
            return Promise.resolve();
          },
          { ...fast, concurrency: 2 },
        ),
      ),
    );

    await waitFor(() => seen.length >= ids.length);
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    expect(seen).toHaveLength(ids.length);
    expect(new Set(seen).size).toBe(ids.length);
  });

  it("retries a failed attempt and reports the attempt number", async () => {
    const schema = uniqueSchema();
    schemas.push(schema);
    const instance = await newQueue(schema);
    await instance.enqueue(queue.name, { flaky: true });

    const attempts: number[] = [];
    await instance.work(
      queue.name,
      (job) => {
        attempts.push(job.attempt);
        return job.attempt === 1
          ? Promise.reject(new Error("transient failure"))
          : Promise.resolve();
      },
      fast,
    );

    await waitFor(() => attempts.length === 2);
    expect(attempts).toEqual([1, 2]);
  });

  it("deduplicates by singletonKey while a job is pending", async () => {
    const schema = uniqueSchema();
    schemas.push(schema);
    const instance = await newQueue(schema);
    const exclusive: QueueDefinition = { ...queue, name: "test.exclusive", policy: "exclusive" };
    await instance.ensureQueue(exclusive);

    const first = await instance.enqueue(exclusive.name, { n: 1 }, { singletonKey: "pub-1" });
    const second = await instance.enqueue(exclusive.name, { n: 2 }, { singletonKey: "pub-1" });
    const other = await instance.enqueue(exclusive.name, { n: 3 }, { singletonKey: "pub-2" });

    expect(first).toEqual(expect.any(String));
    expect(second).toBeNull();
    expect(other).toEqual(expect.any(String));
  });
});
