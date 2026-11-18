import { describe, expect, it } from "vitest";

import {
  evaluateAssetRights,
  evaluateRightsGate,
  licenseInputSchema,
  RIGHTS_STATUSES,
  type RightsAsset,
  type RightsContext,
  type RightsLicense,
} from "../rights";

const at = new Date("2026-11-18T10:00:00Z");
const context: RightsContext = { platform: "youtube", commercial: true, at };

const license: RightsLicense = {
  id: "lic-1",
  allowedPlatforms: ["youtube", "instagram"],
  commercialAllowed: true,
  validFrom: new Date("2026-01-01T00:00:00Z"),
  expiresAt: new Date("2027-01-01T00:00:00Z"),
};

const asset = (overrides: Partial<RightsAsset> = {}): RightsAsset => ({
  id: "asset-1",
  origin: "licensed",
  rightsStatus: "cleared",
  license,
  ...overrides,
});

describe("evaluateAssetRights", () => {
  it("accepts a cleared asset with a valid license for the platform", () => {
    expect(evaluateAssetRights(asset(), context)).toEqual({
      assetId: "asset-1",
      usable: true,
      issues: [],
    });
  });

  it("accepts original work without a license", () => {
    const result = evaluateAssetRights(
      asset({ origin: "original_work", rightsStatus: "original", license: null }),
      context,
    );
    expect(result.usable).toBe(true);
  });

  it.each(RIGHTS_STATUSES.filter((s) => s !== "original" && s !== "cleared"))(
    "blocks status %s",
    (status) => {
      const result = evaluateAssetRights(asset({ rightsStatus: status }), context);
      expect(result.usable).toBe(false);
      expect(result.issues).toContain("status_blocks");
    },
  );

  it("never treats official material or own gameplay as original", () => {
    for (const origin of ["official", "own_capture", "licensed"] as const) {
      const result = evaluateAssetRights(
        asset({ origin, rightsStatus: "original", license: null }),
        context,
      );
      expect(result.usable).toBe(false);
      expect(result.issues).toEqual(["origin_needs_license", "missing_license"]);
    }
  });

  it("blocks a cleared asset without a license", () => {
    const result = evaluateAssetRights(asset({ origin: "ai_generated", license: null }), context);
    expect(result.issues).toEqual(["missing_license"]);
  });

  it("blocks an expired license exactly at its end", () => {
    const result = evaluateAssetRights(asset({ license: { ...license, expiresAt: at } }), context);
    expect(result.issues).toEqual(["license_expired"]);
  });

  it("blocks a license that has not started", () => {
    const result = evaluateAssetRights(
      asset({ license: { ...license, validFrom: new Date("2026-12-01T00:00:00Z") } }),
      context,
    );
    expect(result.issues).toEqual(["license_not_started"]);
  });

  it("blocks a platform the license does not cover", () => {
    const result = evaluateAssetRights(asset(), { ...context, platform: "tiktok" });
    expect(result.issues).toEqual(["platform_not_allowed"]);
  });

  it("checks no platform for a master render", () => {
    expect(evaluateAssetRights(asset(), { ...context, platform: null }).usable).toBe(true);
  });

  it("blocks commercial use when the license forbids it", () => {
    const result = evaluateAssetRights(
      asset({ license: { ...license, commercialAllowed: false } }),
      context,
    );
    expect(result.issues).toEqual(["commercial_not_allowed"]);
    expect(
      evaluateAssetRights(asset({ license: { ...license, commercialAllowed: false } }), {
        ...context,
        commercial: false,
      }).usable,
    ).toBe(true);
  });
});

describe("evaluateRightsGate", () => {
  it("passes when every asset is usable, and with no assets", () => {
    expect(evaluateRightsGate([asset()], context).passed).toBe(true);
    expect(evaluateRightsGate([], context).passed).toBe(true);
  });

  it("lists every blocked asset", () => {
    const result = evaluateRightsGate(
      [asset(), asset({ id: "asset-2", rightsStatus: "disputed" })],
      context,
    );
    expect(result.passed).toBe(false);
    expect(result.blocked.map((b) => b.assetId)).toEqual(["asset-2"]);
  });
});

describe("licenseInputSchema", () => {
  const valid = {
    licensor: "Banco de imágenes",
    termsUrl: "https://example.test/terms",
    scope: "Uso en vídeos cortos",
    allowedPlatforms: ["youtube"],
    commercialAllowed: true,
    allowedTransformations: "Recorte y texto encima",
    territory: "Mundial",
    validFrom: new Date("2026-01-01"),
    expiresAt: new Date("2027-01-01"),
    notes: "",
  };

  it("accepts a complete license and an empty terms URL", () => {
    expect(licenseInputSchema.safeParse(valid).success).toBe(true);
    expect(licenseInputSchema.parse({ ...valid, termsUrl: "" }).termsUrl).toBeNull();
  });

  it("refuses non-https terms, no platforms and an end before the start", () => {
    expect(licenseInputSchema.safeParse({ ...valid, termsUrl: "http://x.test" }).success).toBe(
      false,
    );
    expect(licenseInputSchema.safeParse({ ...valid, allowedPlatforms: [] }).success).toBe(false);
    expect(
      licenseInputSchema.safeParse({ ...valid, expiresAt: new Date("2025-01-01") }).success,
    ).toBe(false);
  });
});
