import { describe, expect, it } from "vitest";

import { createChannelInputSchema, isValidTimeZone, pauseInputSchema } from "../channel";

describe("createChannelInputSchema", () => {
  it("applies safe defaults", () => {
    const parsed = createChannelInputSchema.parse({ platform: "simulated", displayName: " Test " });

    expect(parsed).toEqual({
      platform: "simulated",
      displayName: "Test",
      mode: "draft",
      timezone: "Europe/Madrid",
      maxPostsPerDay: 1,
      minMinutesBetweenPosts: 120,
    });
  });

  it("rejects autopublish in Phase 1", () => {
    const result = createChannelInputSchema.safeParse({
      platform: "simulated",
      displayName: "x",
      mode: "autopublish",
    });

    expect(result.success).toBe(false);
  });

  it("rejects invalid time zones and out-of-range limits", () => {
    expect(
      createChannelInputSchema.safeParse({
        platform: "simulated",
        displayName: "x",
        timezone: "Mars/Olympus",
      }).success,
    ).toBe(false);
    expect(
      createChannelInputSchema.safeParse({
        platform: "simulated",
        displayName: "x",
        maxPostsPerDay: 51,
      }).success,
    ).toBe(false);
  });

  it("accepts DST-observing IANA zones", () => {
    expect(isValidTimeZone("Europe/Madrid")).toBe(true);
    expect(isValidTimeZone("America/Mexico_City")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
  });
});

describe("pauseInputSchema", () => {
  it("requires a reason to pause", () => {
    expect(pauseInputSchema.safeParse({ paused: true }).success).toBe(false);
    expect(pauseInputSchema.safeParse({ paused: true, reason: "ok" }).success).toBe(false);
    expect(pauseInputSchema.safeParse({ paused: true, reason: "Revisión manual" }).success).toBe(
      true,
    );
  });

  it("does not need a reason to resume", () => {
    expect(pauseInputSchema.safeParse({ paused: false }).success).toBe(true);
  });
});
