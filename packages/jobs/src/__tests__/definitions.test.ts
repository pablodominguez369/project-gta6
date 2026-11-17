import { describe, expect, it } from "vitest";

import { publishSimulatedPayloadSchema, QUEUES } from "../definitions";

describe("queue definitions", () => {
  it("use names accepted by pg-boss", () => {
    for (const definition of Object.values(QUEUES)) {
      expect(definition.name).toMatch(/^[\w.\-/]+$/);
    }
  });

  it("payloads carry ids only", () => {
    expect(
      publishSimulatedPayloadSchema.safeParse({
        publicationId: "00000000-0000-4000-8000-000000000001",
      }).success,
    ).toBe(true);
    expect(publishSimulatedPayloadSchema.safeParse({ publicationId: "nope" }).success).toBe(false);
  });
});
