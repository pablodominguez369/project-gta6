import { describe, expect, it } from "vitest";

import { InMemorySimulatedRemoteStore, SimulatedPublisher } from "../simulated-publisher";

import { runPublisherContract, sampleRequest } from "./publisher-contract";

runPublisherContract("SimulatedPublisher", () => new SimulatedPublisher());

describe("SimulatedPublisher fault injection", () => {
  it("timeout_after_accept stores the post but reports an ambiguous result", async () => {
    const store = new InMemorySimulatedRemoteStore();
    const adapter = new SimulatedPublisher({ store, publishFaults: ["timeout_after_accept"] });
    const request = sampleRequest();

    const result = await adapter.publish(request);
    expect(!result.ok && result.error.code).toBe("AMBIGUOUS_EXTERNAL_STATE");
    expect(await store.count()).toBe(1);

    const reconciled = await adapter.reconcile(request);
    expect(reconciled.ok && reconciled.value.found).toBe(true);
  });

  it("timeout_before_accept is ambiguous and leaves nothing on the platform", async () => {
    const store = new InMemorySimulatedRemoteStore();
    const adapter = new SimulatedPublisher({ store, publishFaults: ["timeout_before_accept"] });
    const request = sampleRequest();

    const result = await adapter.publish(request);
    expect(!result.ok && result.error.code).toBe("AMBIGUOUS_EXTERNAL_STATE");
    expect(await store.count()).toBe(0);
    expect(await adapter.reconcile(request)).toEqual({ ok: true, value: { found: false } });
  });

  it.each([
    ["rate_limited", "RATE_LIMITED", true],
    ["unavailable", "EXTERNAL_UNAVAILABLE", true],
    ["credential_expired", "CREDENTIAL_EXPIRED", false],
  ] as const)(
    "%s returns %s (retryable: %s) and stores nothing",
    async (fault, code, retryable) => {
      const store = new InMemorySimulatedRemoteStore();
      const adapter = new SimulatedPublisher({ store, publishFaults: [fault] });

      const result = await adapter.publish(sampleRequest());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(code);
        expect(result.error.retryable).toBe(retryable);
      }
      expect(await store.count()).toBe(0);
    },
  );

  it("is NOT idempotent, like real platforms: publishing twice creates two posts", async () => {
    const store = new InMemorySimulatedRemoteStore();
    const adapter = new SimulatedPublisher({ store });
    const request = sampleRequest();

    await adapter.publish(request);
    await adapter.publish(request);

    expect(await store.count()).toBe(2);
  });

  it("can fail reconciliation itself", async () => {
    const adapter = new SimulatedPublisher({ reconcileFaults: ["reconcile_unavailable"] });
    const result = await adapter.reconcile(sampleRequest());

    expect(!result.ok && result.error.code).toBe("EXTERNAL_UNAVAILABLE");
  });

  it("applies faults in order and then behaves normally", async () => {
    const adapter = new SimulatedPublisher({ publishFaults: ["rate_limited"] });

    expect((await adapter.publish(sampleRequest())).ok).toBe(false);
    expect((await adapter.publish(sampleRequest())).ok).toBe(true);
  });
});
