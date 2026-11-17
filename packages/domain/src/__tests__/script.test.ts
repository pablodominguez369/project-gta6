import { describe, expect, it } from "vitest";

import { evaluateClaimEvidence } from "../claim-evidence";
import { runScriptQa, scriptDraftSchema, type ScriptClaim, type ScriptDraft } from "../script";

const official = {
  publisher: "Estudio",
  sourceType: "official" as const,
  trustLevel: 3,
  publishedAt: new Date("2026-11-10T10:00:00Z"),
};

const confirmed: ScriptClaim = {
  id: "11111111-1111-4111-8111-111111111111",
  text: "El estudio dijo que el juego sale en otoño",
  certainty: "confirmed",
  verified: true,
  evidence: evaluateClaimEvidence({
    certainty: "confirmed",
    sensitive: false,
    sources: [official],
  }),
};
const rumor: ScriptClaim = {
  id: "22222222-2222-4222-8222-222222222222",
  text: "Habrá una edición especial",
  certainty: "rumor",
  verified: false,
  evidence: evaluateClaimEvidence({ certainty: "rumor", sensitive: false, sources: [] }),
};

function draft(lines: Partial<ScriptDraft["lines"][number]>[]): ScriptDraft {
  return scriptDraftSchema.parse({
    lines: lines.map((line) => ({ kind: "body", voice: "Texto de la línea", ...line })),
  });
}

const codes = (report: ReturnType<typeof runScriptQa>) => report.issues.map((i) => i.code);

describe("runScriptQa", () => {
  it("passes a sourced, verified, labelled script", () => {
    const report = runScriptQa(
      draft([
        { kind: "hook", voice: "Hay novedades importantes" },
        {
          kind: "body",
          voice: "El estudio confirma que sale en otoño",
          claim_refs: [confirmed.id],
        },
        { kind: "body", voice: "Y se rumorea una edición especial", claim_refs: [rumor.id] },
      ]),
      [confirmed, rumor],
      20,
    );
    expect(report.passed).toBe(true);
    expect(codes(report)).toEqual(["too_short"]);
  });

  it("requires a claim reference on body and context lines", () => {
    const report = runScriptQa(draft([{ kind: "hook" }, { kind: "context" }]), [], 20);
    expect(report.passed).toBe(false);
    expect(report.issues).toContainEqual({ severity: "error", code: "claim_missing", line: 1 });
  });

  it("rejects claims from elsewhere, unverified facts and weak evidence", () => {
    const unverified = {
      ...confirmed,
      id: "33333333-3333-4333-8333-333333333333",
      verified: false,
    };
    const weak: ScriptClaim = {
      ...confirmed,
      id: "44444444-4444-4444-8444-444444444444",
      evidence: evaluateClaimEvidence({ certainty: "confirmed", sensitive: false, sources: [] }),
    };
    const report = runScriptQa(
      draft([
        { kind: "hook" },
        { claim_refs: ["55555555-5555-4555-8555-555555555555"] },
        { claim_refs: [unverified.id] },
        { claim_refs: [weak.id] },
      ]),
      [unverified, weak],
      20,
    );
    expect(codes(report)).toEqual(
      expect.arrayContaining([
        "unknown_claim",
        "claim_not_verified",
        "claim_evidence_insufficient",
      ]),
    );
  });

  it("requires rumors to be labelled in the line that uses them", () => {
    const report = runScriptQa(
      draft([{ kind: "hook" }, { voice: "Habrá una edición especial", claim_refs: [rumor.id] }]),
      [rumor],
      20,
    );
    expect(report.issues).toContainEqual({ severity: "error", code: "unlabelled_claim", line: 1 });
  });

  it("rejects links and quotes that no claim contains", () => {
    const report = runScriptQa(
      draft([
        { kind: "hook", voice: "Más en www.ejemplo.com" },
        { voice: "Dijeron «un juego enorme»", claim_refs: [confirmed.id] },
      ]),
      [confirmed],
      20,
    );
    expect(codes(report)).toEqual(expect.arrayContaining(["invented_link", "unsourced_quote"]));
  });

  it("accepts a quote that appears in the referenced claim", () => {
    const report = runScriptQa(
      draft([
        { kind: "hook" },
        { voice: "Según el estudio, «sale en otoño»", claim_refs: [confirmed.id] },
      ]),
      [confirmed],
      20,
    );
    expect(codes(report)).not.toContain("unsourced_quote");
  });

  it("blocks leak vocabulary and warns about spoilers", () => {
    const report = runScriptQa(
      draft([
        { kind: "hook", voice: "Mira esta filtración" },
        { voice: "Ojo spoiler del final", claim_refs: [confirmed.id] },
      ]),
      [confirmed],
      20,
    );
    expect(report.issues).toContainEqual({ severity: "error", code: "possible_leak", line: 0 });
    expect(report.issues).toContainEqual({ severity: "warning", code: "spoiler", line: 1 });
  });

  it("checks the duration against the target and the 60 s ceiling", () => {
    const long = "palabra ".repeat(49).trim(); // 49 words, ~19 s per line
    const report = runScriptQa(
      draft([
        { kind: "hook", voice: long },
        { voice: long, claim_refs: [confirmed.id] },
        { voice: long, claim_refs: [confirmed.id] },
        { voice: long, claim_refs: [confirmed.id] },
      ]),
      [confirmed],
      60,
    );
    expect(report.estimatedDurationS).toBeGreaterThan(60);
    expect(codes(report)).toContain("too_long");
  });

  it("warns when the first line is not a hook", () => {
    const report = runScriptQa(
      draft([{ claim_refs: [confirmed.id] }, { kind: "cta" }]),
      [confirmed],
      20,
    );
    expect(codes(report)).toContain("missing_hook");
  });
});

describe("scriptDraftSchema", () => {
  it("rejects unknown fields and too few lines", () => {
    expect(scriptDraftSchema.safeParse({ lines: [{ kind: "hook", voice: "x" }] }).success).toBe(
      false,
    );
    expect(
      scriptDraftSchema.safeParse({
        lines: [
          { kind: "hook", voice: "x", extra: true },
          { kind: "cta", voice: "y" },
        ],
      }).success,
    ).toBe(false);
  });
});
