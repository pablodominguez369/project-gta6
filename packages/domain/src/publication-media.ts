import type { Platform } from "./channel";
import { evaluateRightsGate, type RightsAsset } from "./rights";
import { evaluateVoice, type VoiceRecord } from "./voice";

/** The render a publication points to, with the CURRENT rights state of everything in it. */
export interface PublicationMedia {
  readonly renderId: string;
  readonly qcPassed: boolean;
  /** The render uses a synthetic voice that must be disclosed. */
  readonly disclosureRequired: boolean;
  /** Assets listed in the render manifest, read fresh from the rights registry. */
  readonly assets: readonly RightsAsset[];
  readonly missingAssetIds: readonly string[];
  /** Voice used for the narration, read fresh; null if it no longer exists. */
  readonly voice: VoiceRecord | null;
}

export const PUBLICATION_MEDIA_ISSUES = [
  "render_required",
  "qc_failed",
  "asset_missing",
  "asset_rights",
  "voice_unusable",
  "disclosure_missing",
] as const;
export type PublicationMediaIssue = (typeof PUBLICATION_MEDIA_ISSUES)[number];

export const PUBLICATION_MEDIA_MESSAGES: Readonly<Record<PublicationMediaIssue, string>> = {
  render_required: "Las plataformas reales solo publican un vídeo montado y revisado.",
  qc_failed: "El vídeo no superó el control técnico.",
  asset_missing: "Falta en el registro algún archivo usado en el vídeo.",
  asset_rights: "Algún archivo del vídeo ya no tiene derechos válidos para esta plataforma.",
  voice_unusable: "La voz del vídeo ya no está aprobada o su licencia no está en vigor.",
  disclosure_missing: "El vídeo usa voz sintética y la publicación no lo declara.",
};

export interface PublicationMediaInput {
  readonly platform: Platform;
  readonly media: PublicationMedia | null;
  /** What the publication payload declares to the platform. */
  readonly declaresSyntheticMedia: boolean;
  readonly at: Date;
}

/**
 * Re-checks a publication's video right before every publish attempt (rule 3 and 5). Rights,
 * licenses and voice approvals can change after the render, so the render's own checks are not
 * trusted. Fails closed. The simulator publishes nothing real, so it alone may run without a
 * render (Phase 1 text-only simulations); every real platform requires one.
 */
export function evaluatePublicationMedia(input: PublicationMediaInput): {
  readonly ok: boolean;
  readonly issues: readonly PublicationMediaIssue[];
} {
  const { media } = input;
  if (!media) {
    return input.platform === "simulated"
      ? { ok: true, issues: [] }
      : { ok: false, issues: ["render_required"] };
  }
  const issues: PublicationMediaIssue[] = [];
  if (!media.qcPassed) issues.push("qc_failed");
  if (media.missingAssetIds.length > 0) issues.push("asset_missing");
  const gate = evaluateRightsGate(media.assets, {
    platform: input.platform === "simulated" ? null : input.platform,
    commercial: true,
    at: input.at,
  });
  if (gate.blocked.length > 0) issues.push("asset_rights");
  if (!media.voice || !evaluateVoice(media.voice, input.at).usable) issues.push("voice_unusable");
  if (media.disclosureRequired && !input.declaresSyntheticMedia) issues.push("disclosure_missing");
  return { ok: issues.length === 0, issues };
}
