import type { Platform, RightsLicense, VoiceRecord } from "@gta6/domain";

/** A license row as built by LICENSE_JSON. */
export interface LicenseJson {
  id: string;
  allowed_platforms: Platform[];
  commercial_allowed: boolean;
  valid_from: string | null;
  expires_at: string | null;
}

/** SQL expression for the license joined as `l` (null when there is none). */
export const LICENSE_JSON = `case when l.id is null then null else json_build_object(
  'id', l.id, 'allowed_platforms', l.allowed_platforms, 'commercial_allowed', l.commercial_allowed,
  'valid_from', l.valid_from, 'expires_at', l.expires_at) end`;

export const toLicense = (l: LicenseJson | null): RightsLicense | null =>
  l
    ? {
        id: l.id,
        allowedPlatforms: l.allowed_platforms,
        commercialAllowed: l.commercial_allowed,
        validFrom: l.valid_from ? new Date(l.valid_from) : null,
        expiresAt: l.expires_at ? new Date(l.expires_at) : null,
      }
    : null;

/** Voice columns needed by `evaluateVoice`, selected from `public.voices v`. */
export const VOICE_COLUMNS = `v.id, v.provider, v.provider_voice_id, v.locale, v.imitates_real_person,
  v.consent_proof_path, v.disclosure_required, v.approved_at, v.revoked_at,
  ${LICENSE_JSON} as license`;

export interface VoiceRow {
  id: string;
  provider: string;
  provider_voice_id: string;
  locale: "es-ES" | "es-419";
  imitates_real_person: boolean;
  consent_proof_path: string | null;
  disclosure_required: boolean;
  approved_at: string | null;
  revoked_at: string | null;
  license: LicenseJson | null;
}

export const toVoiceRecord = (voice: VoiceRow): VoiceRecord => ({
  id: voice.id,
  provider: voice.provider,
  approved: voice.approved_at !== null,
  revoked: voice.revoked_at !== null,
  imitatesRealPerson: voice.imitates_real_person,
  hasConsentProof: voice.consent_proof_path !== null,
  license: toLicense(voice.license),
});
