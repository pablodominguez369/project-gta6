import { describe, expect, it } from "vitest";

import { evaluateVoice, type VoiceRecord } from "../voice";

const at = new Date("2026-11-18T10:00:00Z");
const voice = (overrides: Partial<VoiceRecord> = {}): VoiceRecord => ({
  id: "v1",
  provider: "acme-tts",
  approved: true,
  revoked: false,
  imitatesRealPerson: false,
  hasConsentProof: false,
  license: {
    id: "l1",
    allowedPlatforms: ["youtube"],
    commercialAllowed: true,
    validFrom: null,
    expiresAt: new Date("2027-01-01T00:00:00Z"),
  },
  ...overrides,
});

describe("evaluateVoice", () => {
  it("accepts an approved licensed voice", () => {
    expect(evaluateVoice(voice(), at)).toEqual({ usable: true, issues: [] });
  });

  it("accepts the fake development voice without a license", () => {
    expect(evaluateVoice(voice({ provider: "fake", license: null }), at).usable).toBe(true);
  });

  it("blocks unapproved, revoked and unlicensed voices", () => {
    expect(evaluateVoice(voice({ approved: false }), at).issues).toEqual(["not_approved"]);
    expect(evaluateVoice(voice({ revoked: true }), at).issues).toEqual(["revoked"]);
    expect(evaluateVoice(voice({ license: null }), at).issues).toEqual(["missing_license"]);
  });

  it("blocks an expired or non-commercial license", () => {
    const license = voice().license;
    if (!license) throw new Error("fixture");
    expect(evaluateVoice(voice({ license: { ...license, expiresAt: at } }), at).issues).toEqual([
      "license_expired",
    ]);
    expect(
      evaluateVoice(voice({ license: { ...license, commercialAllowed: false } }), at).issues,
    ).toEqual(["commercial_not_allowed"]);
  });

  it("blocks a voice imitating a real person without consent, even the fake one", () => {
    expect(
      evaluateVoice(voice({ provider: "fake", license: null, imitatesRealPerson: true }), at)
        .issues,
    ).toEqual(["missing_consent"]);
    expect(
      evaluateVoice(voice({ imitatesRealPerson: true, hasConsentProof: true }), at).usable,
    ).toBe(true);
  });
});
