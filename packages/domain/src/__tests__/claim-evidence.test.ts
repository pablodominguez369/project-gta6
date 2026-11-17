import { describe, expect, it } from "vitest";

import { evaluateClaimEvidence, type ClaimEvidenceSource } from "../claim-evidence";

const day = new Date("2026-11-10T12:00:00Z");
const official: ClaimEvidenceSource = {
  publisher: "Studio Newswire",
  sourceType: "official",
  trustLevel: 3,
  publishedAt: day,
};
const pressA: ClaimEvidenceSource = {
  publisher: "Press A",
  sourceType: "press",
  trustLevel: 2,
  publishedAt: day,
};
const pressB: ClaimEvidenceSource = { ...pressA, publisher: "Press B" };
const forum: ClaimEvidenceSource = {
  publisher: "Forum",
  sourceType: "community",
  trustLevel: 1,
  publishedAt: day,
};

describe("evaluateClaimEvidence", () => {
  it("accepts a confirmed claim backed by an official source", () => {
    const result = evaluateClaimEvidence({
      certainty: "confirmed",
      sensitive: true,
      sources: [official],
    });
    expect(result).toMatchObject({ ok: true, supportedCertainty: "confirmed", issues: [] });
    expect(result.latestSourceDate).toEqual(day);
  });

  it("rejects confirmed without an official source", () => {
    const result = evaluateClaimEvidence({
      certainty: "confirmed",
      sensitive: false,
      sources: [pressA, pressB],
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(["needs_official_source"]);
    expect(result.supportedCertainty).toBe("reported");
  });

  it("accepts reported with two independent reliable publishers", () => {
    expect(
      evaluateClaimEvidence({ certainty: "reported", sensitive: true, sources: [pressA, pressB] })
        .ok,
    ).toBe(true);
  });

  it("does not count the same publisher twice (case and spaces ignored)", () => {
    const result = evaluateClaimEvidence({
      certainty: "reported",
      sensitive: false,
      sources: [pressA, { ...pressA, publisher: "  press a " }],
    });
    expect(result.issues).toEqual(["needs_two_reliable_sources"]);
  });

  it("raises sensitive_single_source for one non-official source, whatever the certainty", () => {
    for (const certainty of ["reported", "rumor"] as const) {
      const result = evaluateClaimEvidence({ certainty, sensitive: true, sources: [pressA] });
      expect(result.ok).toBe(false);
      expect(result.issues).toContain("sensitive_single_source");
    }
  });

  it("asks for real backing when a sensitive claim only has unreliable sources", () => {
    const result = evaluateClaimEvidence({
      certainty: "rumor",
      sensitive: true,
      sources: [forum, { ...forum, publisher: "Other forum" }],
    });
    expect(result.issues).toEqual(["needs_two_reliable_sources"]);
  });

  it("a sensitive claim with no source is missing a source", () => {
    expect(
      evaluateClaimEvidence({ certainty: "rumor", sensitive: true, sources: [] }).issues,
    ).toEqual(["missing_source"]);
  });

  it("factual claims need a source", () => {
    expect(
      evaluateClaimEvidence({ certainty: "confirmed", sensitive: false, sources: [] }).issues,
    ).toEqual(["missing_source"]);
  });

  it("a non-sensitive rumor needs no source but must be labelled", () => {
    const result = evaluateClaimEvidence({ certainty: "rumor", sensitive: false, sources: [] });
    expect(result).toMatchObject({ ok: true, mustBeLabelled: true, supportedCertainty: "rumor" });
  });

  it("factual claims are not labelled", () => {
    expect(
      evaluateClaimEvidence({ certainty: "confirmed", sensitive: false, sources: [official] })
        .mustBeLabelled,
    ).toBe(false);
  });

  it("flags factual claims whose sources have no date", () => {
    const result = evaluateClaimEvidence({
      certainty: "confirmed",
      sensitive: false,
      sources: [{ ...official, publishedAt: null }],
    });
    expect(result.issues).toEqual(["undated"]);
  });

  it("uses the most recent source date", () => {
    const later = new Date("2026-11-12T08:00:00Z");
    const result = evaluateClaimEvidence({
      certainty: "reported",
      sensitive: false,
      sources: [pressA, { ...pressB, publishedAt: later }],
    });
    expect(result.latestSourceDate).toEqual(later);
  });
});
