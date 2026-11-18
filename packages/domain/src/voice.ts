import type { RightsLicense } from "./rights";

/** The parts of a voice that decide whether it may narrate (rule 5). */
export interface VoiceRecord {
  readonly id: string;
  readonly provider: string;
  readonly approved: boolean;
  readonly revoked: boolean;
  readonly imitatesRealPerson: boolean;
  readonly hasConsentProof: boolean;
  readonly license: RightsLicense | null;
}

export const VOICE_ISSUES = [
  "not_approved",
  "revoked",
  "missing_license",
  "license_expired",
  "commercial_not_allowed",
  "missing_consent",
] as const;
export type VoiceIssue = (typeof VOICE_ISSUES)[number];

export const VOICE_ISSUE_MESSAGES: Readonly<Record<VoiceIssue, string>> = {
  not_approved: "La voz no está aprobada por un revisor de derechos.",
  revoked: "La voz está retirada.",
  missing_license: "La voz no tiene licencia registrada.",
  license_expired: "La licencia de la voz no está en vigor.",
  commercial_not_allowed: "La licencia de la voz no permite uso comercial.",
  missing_consent: "La voz imita a una persona real y no hay prueba de su consentimiento.",
};

/** The fake development provider produces no real speech and needs no license. */
export const FAKE_VOICE_PROVIDER = "fake";

/**
 * Decides whether a voice may be used for a commercial piece at `at`. Fails closed: the
 * database already refuses approvals that break these rules, this re-checks with fresh data
 * right before synthesis (a license may have expired since).
 */
export function evaluateVoice(
  voice: VoiceRecord,
  at: Date,
): { readonly usable: boolean; readonly issues: readonly VoiceIssue[] } {
  const issues: VoiceIssue[] = [];
  if (!voice.approved) issues.push("not_approved");
  if (voice.revoked) issues.push("revoked");
  if (voice.imitatesRealPerson && !voice.hasConsentProof) issues.push("missing_consent");
  if (voice.provider !== FAKE_VOICE_PROVIDER) {
    const license = voice.license;
    if (!license) {
      issues.push("missing_license");
    } else {
      const started = !license.validFrom || license.validFrom.getTime() <= at.getTime();
      const notEnded = !license.expiresAt || license.expiresAt.getTime() > at.getTime();
      if (!started || !notEnded) issues.push("license_expired");
      if (!license.commercialAllowed) issues.push("commercial_not_allowed");
    }
  }
  return { usable: issues.length === 0, issues };
}
