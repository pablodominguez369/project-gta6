import "server-only";

import type { Database } from "@gta6/db";
import { evaluateAssetRights, evaluateVoice, type RightsLicense } from "@gta6/domain";
import type { SupabaseClient } from "@supabase/supabase-js";

export const MEDIA_STATUS_LABELS: Readonly<Record<string, string>> = {
  draft: "Borrador",
  queued: "En cola",
  rendering: "Renderizando",
  rendered: "Renderizado",
  blocked: "Bloqueado",
  failed: "Falló",
};

export interface Option {
  readonly value: string;
  readonly label: string;
}

const toDate = (value: string | null): Date | null => (value ? new Date(value) : null);

/**
 * Assets and voices an editor may pick for a video: only those usable right now. The worker
 * checks again with fresh data before rendering, so this list is a convenience, not the gate.
 */
export async function loadUsableMedia(supabase: SupabaseClient<Database>): Promise<{
  backgrounds: Option[];
  music: Option[];
  voices: Option[];
}> {
  const [{ data: assets }, { data: licenses }, { data: voices }] = await Promise.all([
    supabase
      .from("assets")
      .select("id, title, kind, origin, rights_status, license_id")
      .in("rights_status", ["original", "cleared"])
      .in("kind", ["image", "video", "music", "audio"])
      .order("title")
      .limit(500),
    supabase
      .from("licenses")
      .select("id, allowed_platforms, commercial_allowed, valid_from, expires_at")
      .limit(500),
    supabase
      .from("voices")
      .select(
        "id, provider, display_name, locale, license_id, imitates_real_person, consent_proof_path, approved_at, revoked_at",
      )
      .not("approved_at", "is", null)
      .order("display_name"),
  ]);
  const licenseById = new Map<string, RightsLicense>(
    (licenses ?? []).map((l) => [
      l.id,
      {
        id: l.id,
        allowedPlatforms: l.allowed_platforms,
        commercialAllowed: l.commercial_allowed,
        validFrom: toDate(l.valid_from),
        expiresAt: toDate(l.expires_at),
      },
    ]),
  );
  const now = new Date();
  const usableAssets = (assets ?? []).filter(
    (asset) =>
      evaluateAssetRights(
        {
          id: asset.id,
          origin: asset.origin,
          rightsStatus: asset.rights_status,
          license: asset.license_id ? (licenseById.get(asset.license_id) ?? null) : null,
        },
        { platform: null, commercial: true, at: now },
      ).usable,
  );
  const usableVoices = (voices ?? []).filter(
    (voice) =>
      evaluateVoice(
        {
          id: voice.id,
          provider: voice.provider,
          approved: voice.approved_at !== null,
          revoked: voice.revoked_at !== null,
          imitatesRealPerson: voice.imitates_real_person,
          hasConsentProof: voice.consent_proof_path !== null,
          license: voice.license_id ? (licenseById.get(voice.license_id) ?? null) : null,
        },
        now,
      ).usable,
  );
  return {
    backgrounds: usableAssets
      .filter((a) => a.kind === "image" || a.kind === "video")
      .map((a) => ({ value: a.id, label: a.title })),
    music: usableAssets
      .filter((a) => a.kind === "music" || a.kind === "audio")
      .map((a) => ({ value: a.id, label: a.title })),
    voices: usableVoices.map((v) => ({
      value: v.id,
      label: `${v.display_name} (${v.provider}, ${v.locale})`,
    })),
  };
}
