"use server";

import { randomUUID } from "node:crypto";

import {
  ASSET_MIME_TYPES,
  assetInputSchema,
  licenseInputSchema,
  MAX_ASSET_BYTES,
  PLATFORMS,
  RIGHTS_STATUSES,
} from "@gta6/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionError, actionOk, type ActionState } from "@/lib/action-state";
import { requireRole } from "@/lib/auth/require-role";
import { logger } from "@/lib/logger";
import { assetStoragePath, MIME_EXTENSIONS } from "@/lib/rights";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const UPLOAD_ROLES = ["admin", "editor", "rights_reviewer"] as const;
const REVIEW_ROLES = ["admin", "rights_reviewer"] as const;

export type PrepareUploadResult =
  | { readonly ok: true; readonly path: string; readonly token: string }
  | { readonly ok: false; readonly message: string };

const prepareSchema = z.object({
  mimeType: z.string().max(100),
  size: z.number().int().min(1).max(MAX_ASSET_BYTES),
});

/**
 * Step 1 of an upload: checks type and size and returns a one-time signed upload URL for a new
 * random path. The browser uploads the file straight to Storage (RLS still applies).
 */
export async function prepareAssetUpload(input: {
  mimeType: string;
  size: number;
}): Promise<PrepareUploadResult> {
  await requireRole([...UPLOAD_ROLES]);
  const parsed = prepareSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "El archivo supera los 200 MB." };
  const extension = MIME_EXTENSIONS[parsed.data.mimeType];
  if (!extension || !(parsed.data.mimeType in ASSET_MIME_TYPES)) {
    return { ok: false, message: "Tipo de archivo no permitido." };
  }
  const supabase = await createSupabaseServerClient();
  const path = assetStoragePath(randomUUID(), extension);
  const { data, error } = await supabase.storage.from("media").createSignedUploadUrl(path);
  if (error) {
    logger.error({ storageError: error.name }, "signed upload url failed");
    return { ok: false, message: "No se pudo preparar la subida." };
  }
  return { ok: true, path: data.path, token: data.token };
}

const registerSchema = assetInputSchema.extend({
  storagePath: z.string().regex(/^assets\/[0-9a-f-]{36}\.[a-z0-9]{2,4}$/),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
});

/**
 * Step 2: registers the uploaded file as an asset. The size and type come from Storage, not
 * from the browser. The hash is the browser's; the render worker recomputes it before use and
 * blocks the asset on a mismatch. The database sets the initial rights status.
 */
export async function registerAsset(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireRole([...UPLOAD_ROLES]);
  const parsed = registerSchema.safeParse({
    title: formData.get("title"),
    kind: formData.get("kind"),
    origin: formData.get("origin"),
    owner: formData.get("owner"),
    sourceUrl: formData.get("sourceUrl") ?? "",
    attribution: formData.get("attribution") ?? "",
    storagePath: formData.get("storagePath"),
    contentHash: formData.get("contentHash"),
  });
  if (!parsed.success) return actionError("Revisa los datos del activo y la URL (https).");
  const input = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: info, error: infoError } = await supabase.storage
    .from("media")
    .info(input.storagePath);
  const mimeType = info?.contentType ?? "";
  if (infoError || !info.size || !(mimeType in ASSET_MIME_TYPES)) {
    return actionError("No encuentro el archivo subido o su tipo no está permitido.");
  }

  const { error } = await supabase.from("assets").insert({
    title: input.title,
    kind: input.kind,
    origin: input.origin,
    owner: input.owner,
    source_url: input.sourceUrl,
    attribution: input.attribution,
    storage_path: input.storagePath,
    content_hash: input.contentHash,
    mime_type: mimeType,
    size_bytes: info.size,
    created_by: user.id,
  });
  if (error?.code === "23505") return actionError("Este archivo ya está registrado.");
  if (error) {
    logger.error({ dbErrorCode: error.code }, "asset register failed");
    return actionError("No se pudo registrar el activo.");
  }
  revalidatePath("/admin/assets");
  return actionOk("Activo registrado. Un revisor de derechos debe autorizarlo antes de usarlo.");
}

function dateOrNull(value: FormDataEntryValue | null): Date | null | "invalid" {
  if (typeof value !== "string" || value.trim() === "") return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? "invalid" : date;
}

function text(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

/** A rights reviewer records a license (written permission, stock license...). */
export async function createLicense(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireRole([...REVIEW_ROLES]);
  const validFrom = dateOrNull(formData.get("validFrom"));
  const expiresAt = dateOrNull(formData.get("expiresAt"));
  if (validFrom === "invalid" || expiresAt === "invalid") return actionError("Fecha no válida.");
  const parsed = licenseInputSchema.safeParse({
    licensor: text(formData.get("licensor")),
    termsUrl: text(formData.get("termsUrl")),
    scope: text(formData.get("scope")),
    allowedPlatforms: formData
      .getAll("allowedPlatforms")
      .filter((p): p is string => typeof p === "string")
      .filter((p) => (PLATFORMS as readonly string[]).includes(p)),
    commercialAllowed: formData.get("commercialAllowed") === "on",
    allowedTransformations: text(formData.get("allowedTransformations")),
    territory: text(formData.get("territory")),
    validFrom,
    expiresAt,
    notes: text(formData.get("notes")),
  });
  if (!parsed.success) {
    return actionError(
      parsed.error.issues[0]?.path[0] === "expiresAt"
        ? "La fecha de fin debe ser posterior a la de inicio."
        : "Revisa la licencia: titular, alcance, territorio y al menos una plataforma.",
    );
  }
  const input = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("licenses").insert({
    licensor: input.licensor,
    terms_url: input.termsUrl,
    scope: input.scope,
    allowed_platforms: [...input.allowedPlatforms],
    commercial_allowed: input.commercialAllowed,
    allowed_transformations: input.allowedTransformations,
    territory: input.territory,
    valid_from: input.validFrom?.toISOString() ?? null,
    expires_at: input.expiresAt?.toISOString() ?? null,
    notes: input.notes,
    created_by: user.id,
  });
  if (error) {
    logger.error({ dbErrorCode: error.code }, "license create failed");
    return actionError("No se pudo guardar la licencia.");
  }
  revalidatePath("/admin/assets");
  return actionOk("Licencia guardada.");
}

const reviewSchema = z.object({
  assetId: z.uuid(),
  rightsStatus: z.enum(RIGHTS_STATUSES),
  licenseId: z
    .string()
    .transform((value) => (value === "" ? null : value))
    .pipe(z.uuid().nullable()),
  note: z.string().trim().max(1000),
});

/** A rights reviewer decides an asset's status. The database enforces the rules again. */
export async function reviewAsset(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([...REVIEW_ROLES]);
  const parsed = reviewSchema.safeParse({
    assetId: formData.get("assetId"),
    rightsStatus: formData.get("rightsStatus"),
    licenseId: formData.get("licenseId") ?? "",
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) return actionError("Decisión no válida.");
  const { assetId, rightsStatus, licenseId, note } = parsed.data;
  if (rightsStatus === "cleared" && !licenseId) {
    return actionError("Para autorizar hay que elegir la licencia.");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("assets")
    .update({ rights_status: rightsStatus, license_id: licenseId, rights_note: note })
    .eq("id", assetId);
  if (error?.code === "23514") {
    return actionError(
      "No se puede: el material oficial, las capturas propias y los bancos de imágenes necesitan licencia; solo lo creado por nosotros o con IA puede ser «Original».",
    );
  }
  if (error) {
    logger.error({ dbErrorCode: error.code }, "asset review failed");
    return actionError("No se pudo guardar la decisión.");
  }
  revalidatePath("/admin/assets");
  return actionOk("Decisión guardada.");
}
