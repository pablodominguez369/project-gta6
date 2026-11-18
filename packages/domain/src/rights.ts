import { z } from "zod";

import { PLATFORMS, type Platform } from "./channel";

/**
 * Rights registry (spec section 8). Only `original` and `cleared` assets may be used in a render
 * that can be published; every other status blocks (rule 3). Must match `public.rights_status`.
 */
export const RIGHTS_STATUSES = [
  "original",
  "cleared",
  "requires_permission",
  "unknown",
  "restricted",
  "expired",
  "disputed",
] as const;
export type RightsStatus = (typeof RIGHTS_STATUSES)[number];

/** Must match `public.asset_kind`. */
export const ASSET_KINDS = ["image", "video", "audio", "music", "font", "voice"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/**
 * Where an asset comes from. Must match `public.asset_origin`.
 * - original_work: made by the team (graphics, own music, own photos).
 * - ai_generated: generated with a provider whose terms allow commercial use.
 * - own_capture: our own gameplay capture. Still protected by the game's owner: needs permission.
 * - official: trailers, screenshots, art or clips from the publisher. Needs permission.
 * - licensed: stock or library material with a license.
 */
export const ASSET_ORIGINS = [
  "original_work",
  "ai_generated",
  "own_capture",
  "official",
  "licensed",
] as const;
export type AssetOrigin = (typeof ASSET_ORIGINS)[number];

/** Origins that can be marked `original` without a license. */
export const SELF_OWNED_ORIGINS: readonly AssetOrigin[] = ["original_work", "ai_generated"];

/** Origins that always need a recorded license (spec: "requires_permission" until authorised). */
export const PERMISSION_ORIGINS: readonly AssetOrigin[] = ["own_capture", "official", "licensed"];

export const RIGHTS_STATUS_LABELS: Readonly<Record<RightsStatus, string>> = {
  original: "Original",
  cleared: "Autorizado",
  requires_permission: "Requiere permiso",
  unknown: "Sin revisar",
  restricted: "Restringido",
  expired: "Caducado",
  disputed: "Reclamado",
};

export interface RightsLicense {
  readonly id: string;
  readonly allowedPlatforms: readonly Platform[];
  readonly commercialAllowed: boolean;
  readonly validFrom: Date | null;
  readonly expiresAt: Date | null;
}

export interface RightsAsset {
  readonly id: string;
  readonly origin: AssetOrigin;
  readonly rightsStatus: RightsStatus;
  readonly license: RightsLicense | null;
}

export interface RightsContext {
  /** Platform the piece will go to. `null` checks the asset for any use (e.g. a master render). */
  readonly platform: Platform | null;
  /** The channel may monetise or promote a brand: treat every use as commercial by default. */
  readonly commercial: boolean;
  readonly at: Date;
}

export const RIGHTS_ISSUES = [
  /** Status is not original/cleared. */
  "status_blocks",
  /** Marked original but the origin needs a license (own captures, official material, stock). */
  "origin_needs_license",
  /** Cleared without a license on record. */
  "missing_license",
  "license_not_started",
  "license_expired",
  "platform_not_allowed",
  "commercial_not_allowed",
] as const;
export type RightsIssue = (typeof RIGHTS_ISSUES)[number];

export const RIGHTS_ISSUE_MESSAGES: Readonly<Record<RightsIssue, string>> = {
  status_blocks: "El estado de derechos no permite usarlo.",
  origin_needs_license: "Este origen necesita una licencia registrada.",
  missing_license: "Está autorizado pero no tiene licencia registrada.",
  license_not_started: "La licencia todavía no ha empezado.",
  license_expired: "La licencia ha caducado.",
  platform_not_allowed: "La licencia no cubre esta plataforma.",
  commercial_not_allowed: "La licencia no permite uso comercial.",
};

export interface AssetRightsResult {
  readonly assetId: string;
  readonly usable: boolean;
  readonly issues: readonly RightsIssue[];
}

/**
 * Decides whether an asset may be used. Fails closed: anything not explicitly allowed blocks.
 * Pure; the worker runs it before rendering and again before publishing, with fresh data.
 */
export function evaluateAssetRights(asset: RightsAsset, context: RightsContext): AssetRightsResult {
  const issues: RightsIssue[] = [];
  if (asset.rightsStatus !== "original" && asset.rightsStatus !== "cleared") {
    issues.push("status_blocks");
  }
  if (asset.rightsStatus === "original" && !SELF_OWNED_ORIGINS.includes(asset.origin)) {
    issues.push("origin_needs_license");
  }
  const needsLicense =
    asset.rightsStatus === "cleared" || PERMISSION_ORIGINS.includes(asset.origin);
  const license = asset.license;
  if (needsLicense && !license) {
    issues.push("missing_license");
  }
  if (license && needsLicense) {
    if (license.validFrom && license.validFrom.getTime() > context.at.getTime()) {
      issues.push("license_not_started");
    }
    if (license.expiresAt && license.expiresAt.getTime() <= context.at.getTime()) {
      issues.push("license_expired");
    }
    if (context.platform && !license.allowedPlatforms.includes(context.platform)) {
      issues.push("platform_not_allowed");
    }
    if (context.commercial && !license.commercialAllowed) {
      issues.push("commercial_not_allowed");
    }
  }
  return { assetId: asset.id, usable: issues.length === 0, issues };
}

export interface RightsGateResult {
  readonly passed: boolean;
  readonly blocked: readonly AssetRightsResult[];
}

/** Every asset must be usable; an empty list passes (a piece with no third-party assets). */
export function evaluateRightsGate(
  assets: readonly RightsAsset[],
  context: RightsContext,
): RightsGateResult {
  const blocked = assets
    .map((asset) => evaluateAssetRights(asset, context))
    .filter((result) => !result.usable);
  return { passed: blocked.length === 0, blocked };
}

/** Allowed upload types and size, shared by the web form, the storage bucket and the worker. */
export const ASSET_MIME_TYPES: Readonly<Record<string, AssetKind>> = {
  "image/png": "image",
  "image/jpeg": "image",
  "image/webp": "image",
  "video/mp4": "video",
  "audio/mpeg": "audio",
  "audio/wav": "audio",
  "audio/x-wav": "audio",
  "font/ttf": "font",
  "font/otf": "font",
};
export const MAX_ASSET_BYTES = 200 * 1024 * 1024;

const optionalUrl = z
  .string()
  .trim()
  .max(2000)
  .transform((value) => (value === "" ? null : value))
  .pipe(z.url({ protocol: /^https$/ }).nullable());

export const licenseInputSchema = z
  .object({
    licensor: z.string().trim().min(1).max(200),
    termsUrl: optionalUrl,
    scope: z.string().trim().min(3).max(2000),
    allowedPlatforms: z.array(z.enum(PLATFORMS)).min(1),
    commercialAllowed: z.boolean(),
    allowedTransformations: z.string().trim().max(1000),
    territory: z.string().trim().min(2).max(200),
    validFrom: z.date().nullable(),
    expiresAt: z.date().nullable(),
    notes: z.string().trim().max(2000),
  })
  .refine((value) => !value.validFrom || !value.expiresAt || value.validFrom < value.expiresAt, {
    message: "La fecha de fin debe ser posterior a la de inicio",
    path: ["expiresAt"],
  });
export type LicenseInput = z.infer<typeof licenseInputSchema>;

export const assetInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  kind: z.enum(ASSET_KINDS),
  origin: z.enum(ASSET_ORIGINS),
  owner: z.string().trim().min(1).max(200),
  sourceUrl: optionalUrl,
  attribution: z.string().trim().max(500),
});
export type AssetInput = z.infer<typeof assetInputSchema>;
