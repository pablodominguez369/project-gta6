import { describe, expect, it } from "vitest";

import { DomainError, isDomainError } from "../errors";

describe("DomainError", () => {
  it("keeps code, message and safe details", () => {
    const error = new DomainError("CHANNEL_PAUSED", "Channel is paused", {
      details: { channelId: "c-1" },
    });

    expect(error.code).toBe("CHANNEL_PAUSED");
    expect(error.message).toBe("Channel is paused");
    expect(error.details).toEqual({ channelId: "c-1" });
    expect(isDomainError(error)).toBe(true);
    expect(isDomainError(new Error("plain"))).toBe(false);
  });

  it("marks only transient codes as retryable", () => {
    expect(new DomainError("RATE_LIMITED", "429").retryable).toBe(true);
    expect(new DomainError("EXTERNAL_UNAVAILABLE", "503").retryable).toBe(true);
    expect(new DomainError("AMBIGUOUS_EXTERNAL_STATE", "timeout after accept").retryable).toBe(
      false,
    );
    expect(new DomainError("SYSTEM_PAUSED", "paused").retryable).toBe(false);
  });

  it("serializes without stack or cause", () => {
    const error = new DomainError("INTERNAL", "failed", { cause: new Error("secret-ish") });
    const json = JSON.stringify(error);

    expect(JSON.parse(json)).toEqual({
      name: "DomainError",
      code: "INTERNAL",
      message: "failed",
      details: {},
    });
    expect(json).not.toContain("secret-ish");
    expect(json).not.toContain("stack");
  });
});
