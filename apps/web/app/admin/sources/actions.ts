"use server";

import { createHash } from "node:crypto";

import { canonicalizeUrl, SOURCE_TYPES, toExcerpt, toPlainText } from "@gta6/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionError, actionOk, type ActionState } from "@/lib/action-state";
import { requireRole } from "@/lib/auth/require-role";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Empty form fields mean "not given". */
function optionalField(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

const manualSourceSchema = z.object({
  url: z.string().trim().min(1).max(2000),
  title: z.string().trim().min(1).max(500),
  publisher: z.string().trim().min(1).max(200),
  sourceType: z.enum(SOURCE_TYPES),
  publishedAt: z.iso.date().optional(),
  excerpt: z.string().max(5000).optional(),
});

/** An editor records a source by hand. Only metadata and a short excerpt are kept. */
export async function addManualSource(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireRole(["admin", "editor"]);
  const parsed = manualSourceSchema.safeParse({
    url: formData.get("url"),
    title: formData.get("title"),
    publisher: formData.get("publisher"),
    sourceType: formData.get("sourceType"),
    publishedAt: optionalField(formData, "publishedAt"),
    excerpt: optionalField(formData, "excerpt"),
  });
  if (!parsed.success) return actionError("Revisa la URL, el título, el medio y el tipo.");
  const canonical = canonicalizeUrl(parsed.data.url);
  if (!canonical.ok) return actionError("La URL no es válida (solo http o https).");

  const title = toPlainText(parsed.data.title);
  const excerpt = toExcerpt(parsed.data.excerpt);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("sources").insert({
    url: parsed.data.url,
    canonical_url: canonical.value,
    publisher: parsed.data.publisher,
    title,
    source_type: parsed.data.sourceType,
    published_at: parsed.data.publishedAt ?? null,
    excerpt,
    content_hash: createHash("sha256")
      .update(`${canonical.value}\n${title}\n${excerpt ?? ""}`)
      .digest("hex"),
    added_by: user.id,
  });
  if (error?.code === "23505") return actionOk("Esa fuente ya estaba registrada.");
  if (error) {
    logger.error({ dbErrorCode: error.code }, "manual source insert failed");
    return actionError("No se pudo guardar la fuente.");
  }
  revalidatePath("/admin/sources");
  return actionOk("Fuente añadida.");
}

const feedSchema = z.object({
  url: z.url({ protocol: /^https$/ }).max(2000),
  publisher: z.string().trim().min(1).max(200),
  kind: z.enum(["rss", "atom"]),
  sourceType: z.enum(SOURCE_TYPES),
  trustLevel: z.coerce.number().int().min(0).max(3),
});

/** Admins add a feed to the allowlist. It starts disabled until its terms are reviewed. */
export async function addFeed(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(["admin"]);
  const parsed = feedSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return actionError("La URL del feed debe empezar por https://.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("feed_sources").insert({
    url: parsed.data.url,
    publisher: parsed.data.publisher,
    kind: parsed.data.kind,
    source_type: parsed.data.sourceType,
    trust_level: parsed.data.trustLevel,
    created_by: user.id,
  });
  if (error?.code === "23505") return actionOk("Ese feed ya estaba en la lista.");
  if (error) {
    logger.error({ dbErrorCode: error.code }, "feed insert failed");
    return actionError("No se pudo añadir el feed.");
  }
  revalidatePath("/admin/sources");
  return actionOk("Feed añadido (desactivado hasta revisar sus términos).");
}

const enableSchema = z.object({
  feedId: z.uuid(),
  termsUrl: z.url({ protocol: /^https?$/ }).max(2000),
  termsReviewed: z.literal("on"),
});

/** Enabling records who reviewed the feed's terms and when (rule 3). */
export async function enableFeed(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["admin"]);
  const parsed = enableSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return actionError("Indica la URL de los términos y confirma que los has revisado.");
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("feed_sources")
    .update({
      terms_url: parsed.data.termsUrl,
      terms_checked_at: new Date().toISOString(),
      enabled: true,
      consecutive_failures: 0,
    })
    .eq("id", parsed.data.feedId);
  if (error) {
    logger.error({ dbErrorCode: error.code }, "feed enable failed");
    return actionError("No se pudo activar el feed.");
  }
  revalidatePath("/admin/sources");
  return actionOk("Feed activado.");
}

export async function disableFeed(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole(["admin"]);
  const feedId = z.uuid().safeParse(formData.get("feedId"));
  if (!feedId.success) return actionError("Feed no válido.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("feed_sources")
    .update({ enabled: false })
    .eq("id", feedId.data);
  if (error) {
    logger.error({ dbErrorCode: error.code }, "feed disable failed");
    return actionError("No se pudo desactivar el feed.");
  }
  revalidatePath("/admin/sources");
  return actionOk("Feed desactivado.");
}
