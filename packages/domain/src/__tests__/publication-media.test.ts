import { describe, expect, it } from "vitest";

import { evaluatePublicationMedia, type PublicationMedia } from "../publication-media";
import type { RightsAsset } from "../rights";
import type { VoiceRecord } from "../voice";

const AT = new Date("2026-11-20T12:00:00Z");

const ownAsset: RightsAsset = {
  id: "a1",
  origin: "original_work",
  rightsStatus: "original",
  license: null,
};

const fakeVoice: VoiceRecord = {
  id: "v1",
  provider: "fake",
  approved: true,
  revoked: false,
  imitatesRealPerson: false,
  hasConsentProof: false,
  license: null,
};

function media(overrides: Partial<PublicationMedia> = {}): PublicationMedia {
  return {
    renderId: "r1",
    qcPassed: true,
    disclosureRequired: true,
    assets: [ownAsset],
    missingAssetIds: [],
    voice: fakeVoice,
    ...overrides,
  };
}

describe("evaluatePublicationMedia", () => {
  it("passes a clean render that declares its synthetic voice", () => {
    expect(
      evaluatePublicationMedia({
        platform: "simulated",
        media: media(),
        declaresSyntheticMedia: true,
        at: AT,
      }),
    ).toEqual({ ok: true, issues: [] });
  });

  it("lets only the simulator run without a render", () => {
    const base = { media: null, declaresSyntheticMedia: false, at: AT };
    expect(evaluatePublicationMedia({ ...base, platform: "simulated" }).ok).toBe(true);
    expect(evaluatePublicationMedia({ ...base, platform: "youtube" }).issues).toEqual([
      "render_required",
    ]);
  });

  it("blocks a render that failed QC", () => {
    const result = evaluatePublicationMedia({
      platform: "simulated",
      media: media({ qcPassed: false }),
      declaresSyntheticMedia: true,
      at: AT,
    });
    expect(result.issues).toEqual(["qc_failed"]);
  });

  it("blocks when an asset's rights changed after the render", () => {
    const result = evaluatePublicationMedia({
      platform: "simulated",
      media: media({ assets: [{ ...ownAsset, rightsStatus: "disputed" }] }),
      declaresSyntheticMedia: true,
      at: AT,
    });
    expect(result.issues).toEqual(["asset_rights"]);
  });

  it("blocks when the license does not cover the channel's platform", () => {
    const licensed: RightsAsset = {
      id: "a2",
      origin: "licensed",
      rightsStatus: "cleared",
      license: {
        id: "l1",
        allowedPlatforms: ["youtube"],
        commercialAllowed: true,
        validFrom: null,
        expiresAt: null,
      },
    };
    const input = { media: media({ assets: [licensed] }), declaresSyntheticMedia: true, at: AT };
    expect(evaluatePublicationMedia({ ...input, platform: "youtube" }).ok).toBe(true);
    expect(evaluatePublicationMedia({ ...input, platform: "tiktok" }).issues).toEqual([
      "asset_rights",
    ]);
  });

  it("blocks missing assets, a revoked or deleted voice, and an undeclared synthetic voice", () => {
    const result = evaluatePublicationMedia({
      platform: "simulated",
      media: media({ missingAssetIds: ["gone"], voice: { ...fakeVoice, revoked: true } }),
      declaresSyntheticMedia: false,
      at: AT,
    });
    expect(result.issues).toEqual(["asset_missing", "voice_unusable", "disclosure_missing"]);
    expect(
      evaluatePublicationMedia({
        platform: "simulated",
        media: media({ voice: null }),
        declaresSyntheticMedia: true,
        at: AT,
      }).issues,
    ).toEqual(["voice_unusable"]);
  });
});
