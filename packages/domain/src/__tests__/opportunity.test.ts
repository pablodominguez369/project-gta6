import { describe, expect, it } from "vitest";

import {
  assessOpportunity,
  findCluster,
  normalizeTitle,
  titleSimilarity,
  type EvidenceSource,
} from "../opportunity";

const now = new Date("2026-11-17T12:00:00Z");
const source = (overrides: Partial<EvidenceSource> = {}): EvidenceSource => ({
  publisher: "Medio A",
  sourceType: "press",
  trustLevel: 2,
  title: "Rockstar publica el segundo tráiler",
  excerpt: null,
  publishedAt: new Date("2026-11-17T10:00:00Z"),
  observedAt: new Date("2026-11-17T10:05:00Z"),
  ...overrides,
});

describe("title similarity and clustering", () => {
  it("normalizes accents and punctuation", () => {
    expect(normalizeTitle("¡Tráiler 2, YA!")).toBe("trailer 2 ya");
  });

  it("scores the same story from different outlets high and unrelated stories low", () => {
    expect(
      titleSimilarity(
        "Rockstar publica el segundo tráiler de GTA VI",
        "GTA VI: Rockstar publica su segundo tráiler",
      ),
    ).toBeGreaterThanOrEqual(0.5);
    expect(
      titleSimilarity(
        "Rockstar publica el segundo tráiler de GTA VI",
        "Take-Two presenta resultados",
      ),
    ).toBeLessThan(0.2);
  });

  it("joins the best matching opportunity, or none", () => {
    const candidates = [
      { opportunityId: "a", titles: ["Take-Two presenta resultados trimestrales"] },
      { opportunityId: "b", titles: ["Rockstar publica el segundo tráiler de GTA VI"] },
    ];
    expect(findCluster("GTA VI: Rockstar publica su segundo tráiler", candidates)).toBe("b");
    expect(findCluster("Nueva consola anunciada", candidates)).toBeNull();
  });
});

describe("assessOpportunity", () => {
  it("one official source makes it confirmed", () => {
    const result = assessOpportunity([source({ sourceType: "official", trustLevel: 3 })], now);
    expect(result.certainty).toBe("confirmed");
  });

  it("two independent reliable publishers make it reported", () => {
    const result = assessOpportunity([source(), source({ publisher: "Medio B" })], now);
    expect(result.certainty).toBe("reported");
    expect(result.riskFlags).not.toContain("single_source");
  });

  it("the same publisher twice is still a single source and a rumor", () => {
    const result = assessOpportunity([source(), source({ publisher: " medio a " })], now);
    expect(result.certainty).toBe("rumor");
    expect(result.riskFlags).toContain("single_source");
  });

  it("community sources alone are a rumor, and unknown provenance is flagged", () => {
    const result = assessOpportunity([source({ trustLevel: 0, sourceType: "community" })], now);
    expect(result.certainty).toBe("rumor");
    expect(result.riskFlags).toEqual(
      expect.arrayContaining(["unknown_provenance", "single_source"]),
    );
  });

  it("discards possible leaks automatically", () => {
    const result = assessOpportunity(
      [source({ title: "Filtración: vídeo de una build interna" })],
      now,
    );
    expect(result.riskFlags).toContain("leak");
    expect(result.discardReason).not.toBeNull();
  });

  it("does not treat words that merely contain a leak term as a leak", () => {
    expect(
      assessOpportunity([source({ title: "Bleak weather in Vice City" })], now).riskFlags,
    ).not.toContain("leak");
  });

  it("scores fresh, well-covered official news above an old rumor", () => {
    const strong = assessOpportunity(
      [source({ sourceType: "official", trustLevel: 3 }), source({ publisher: "Medio B" })],
      now,
    );
    const weak = assessOpportunity(
      [source({ trustLevel: 1, publishedAt: new Date("2026-11-14T00:00:00Z") })],
      now,
    );
    expect(strong.score).toBeGreaterThan(weak.score);
    expect(weak.score).toBeGreaterThanOrEqual(0);
    expect(strong.score).toBeLessThanOrEqual(100);
  });

  it("expires 72 hours after the latest source", () => {
    expect(assessOpportunity([source()], now).expiresAt.toISOString()).toBe(
      "2026-11-20T10:00:00.000Z",
    );
  });
});
