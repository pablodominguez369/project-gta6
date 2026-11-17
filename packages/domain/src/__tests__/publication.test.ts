import { describe, expect, it } from "vitest";

import {
  canTransition,
  checkFrequency,
  evaluatePublishGates,
  isTerminal,
  localDate,
  mayHaveReachedPlatform,
  publicationPayloadSchema,
} from "../publication";

const openGates = {
  systemPaused: false,
  channelPaused: false,
  platform: "simulated",
  publishingMode: "simulated" as const,
};

describe("publication state machine", () => {
  it("never leaves a terminal state", () => {
    expect(isTerminal("succeeded")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(canTransition("succeeded", "in_progress")).toBe(false);
    expect(canTransition("failed", "queued")).toBe(false);
  });

  it("resolves ambiguous only via reconciliation outcomes, never back to queued", () => {
    expect(canTransition("ambiguous", "succeeded")).toBe(true);
    expect(canTransition("ambiguous", "in_progress")).toBe(true);
    expect(canTransition("ambiguous", "queued")).toBe(false);
  });

  it("lets a pause block an ambiguous publication (reconcile_required keeps it safe)", () => {
    expect(canTransition("ambiguous", "blocked")).toBe(true);
    expect(canTransition("blocked", "in_progress")).toBe(true);
  });

  it("requires reconciliation when an earlier attempt may have reached the platform", () => {
    expect(mayHaveReachedPlatform("in_progress")).toBe(true);
    expect(mayHaveReachedPlatform("ambiguous")).toBe(true);
    expect(mayHaveReachedPlatform("queued")).toBe(false);
    expect(mayHaveReachedPlatform("blocked")).toBe(false);
  });
});

describe("evaluatePublishGates", () => {
  it("passes when nothing blocks", () => {
    expect(evaluatePublishGates(openGates).ok).toBe(true);
  });

  it("blocks on global pause first, then channel pause", () => {
    const both = evaluatePublishGates({ ...openGates, systemPaused: true, channelPaused: true });
    expect(!both.ok && both.error.code).toBe("SYSTEM_PAUSED");
    const channel = evaluatePublishGates({ ...openGates, channelPaused: true });
    expect(!channel.ok && channel.error.code).toBe("CHANNEL_PAUSED");
  });

  it.each(["youtube", "instagram", "tiktok"])("refuses real platform %s in Phase 1", (platform) => {
    const result = evaluatePublishGates({ ...openGates, platform });
    expect(!result.ok && result.error.code).toBe("FORBIDDEN");
  });
});

describe("checkFrequency", () => {
  const base = { timezone: "Europe/Madrid", maxPostsPerDay: 2, minMinutesBetweenPosts: 60 };

  it("allows when under limits", () => {
    const result = checkFrequency({
      ...base,
      now: new Date("2026-11-17T12:00:00Z"),
      recentPublishedAt: [new Date("2026-11-17T09:00:00Z")],
    });
    expect(result.ok).toBe(true);
  });

  it("blocks when the daily maximum is reached", () => {
    const result = checkFrequency({
      ...base,
      now: new Date("2026-11-17T20:00:00Z"),
      recentPublishedAt: [new Date("2026-11-17T08:00:00Z"), new Date("2026-11-17T10:00:00Z")],
    });
    expect(!result.ok && result.error.code).toBe("RATE_LIMITED");
  });

  it("blocks inside the minimum gap", () => {
    const result = checkFrequency({
      ...base,
      now: new Date("2026-11-17T12:30:00Z"),
      recentPublishedAt: [new Date("2026-11-17T12:00:00Z")],
    });
    expect(!result.ok && result.error.code).toBe("RATE_LIMITED");
  });

  it("counts days in the channel's time zone, not UTC", () => {
    // 23:30 UTC on 17 Nov is already 18 Nov in Madrid (UTC+1 in winter).
    expect(localDate(new Date("2026-11-17T23:30:00Z"), "Europe/Madrid")).toBe("2026-11-18");
    const result = checkFrequency({
      ...base,
      maxPostsPerDay: 1,
      now: new Date("2026-11-17T23:30:00Z"),
      recentPublishedAt: [new Date("2026-11-17T12:00:00Z")],
    });
    expect(result.ok).toBe(true);
  });

  it("handles the autumn DST change (25 Oct 2026, Madrid goes from UTC+2 to UTC+1)", () => {
    // 22:30 UTC on 24 Oct = 00:30 local on 25 Oct (still UTC+2).
    expect(localDate(new Date("2026-10-24T22:30:00Z"), "Europe/Madrid")).toBe("2026-10-25");
    // 22:30 UTC on 25 Oct = 23:30 local on 25 Oct (now UTC+1): the 25th lasts 25 hours.
    expect(localDate(new Date("2026-10-25T22:30:00Z"), "Europe/Madrid")).toBe("2026-10-25");
    const result = checkFrequency({
      ...base,
      maxPostsPerDay: 1,
      now: new Date("2026-10-25T22:30:00Z"),
      recentPublishedAt: [new Date("2026-10-24T22:30:00Z")],
    });
    expect(!result.ok && result.error.code).toBe("RATE_LIMITED");
  });

  it("handles the spring DST change (29 Mar 2026, Madrid goes from UTC+1 to UTC+2)", () => {
    // 22:30 UTC on 28 Mar = 23:30 local on the 28th; 22:30 UTC on 29 Mar = 00:30 on the 30th.
    expect(localDate(new Date("2026-03-28T22:30:00Z"), "Europe/Madrid")).toBe("2026-03-28");
    expect(localDate(new Date("2026-03-29T22:30:00Z"), "Europe/Madrid")).toBe("2026-03-30");
  });

  it("uses each channel's own zone", () => {
    const now = new Date("2026-11-18T03:00:00Z"); // 18 Nov in Madrid, still 17 Nov in Mexico City
    const earlier = [new Date("2026-11-17T20:00:00Z")]; // 17 Nov in both zones
    expect(
      checkFrequency({
        ...base,
        maxPostsPerDay: 1,
        timezone: "Europe/Madrid",
        now,
        recentPublishedAt: earlier,
      }).ok,
    ).toBe(true);
    expect(
      checkFrequency({
        ...base,
        maxPostsPerDay: 1,
        timezone: "America/Mexico_City",
        now,
        recentPublishedAt: earlier,
      }).ok,
    ).toBe(false);
  });
});

describe("publicationPayloadSchema", () => {
  it("accepts a minimal payload and trims text", () => {
    const parsed = publicationPayloadSchema.parse({
      title: "  Tráiler 2: claves  ",
      description: "",
      mediaRef: "simulated://media/placeholder",
    });
    expect(parsed.title).toBe("Tráiler 2: claves");
  });

  it("rejects an empty title and a missing media reference", () => {
    expect(
      publicationPayloadSchema.safeParse({ title: " ", description: "", mediaRef: "x" }).success,
    ).toBe(false);
    expect(publicationPayloadSchema.safeParse({ title: "Ok", description: "" }).success).toBe(
      false,
    );
  });
});
