import type { Platform } from "./channel";

/** Hosts a manual permalink may point to, per platform (exact host or a subdomain of it). */
const PERMALINK_HOSTS: Readonly<Record<Platform, readonly string[]>> = {
  youtube: ["youtube.com", "youtu.be"],
  instagram: ["instagram.com"],
  tiktok: ["tiktok.com"],
  simulated: ["simulated.invalid"],
};

/**
 * Checks the link an operator pastes after a manual upload: https, at most 500 characters, and
 * on the platform's own domain, so a typo or a link to another site is not recorded as the post.
 */
export function isPlatformPermalink(platform: Platform, value: string): boolean {
  if (value.length > 500) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return PERMALINK_HOSTS[platform].some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
}

/**
 * What the operator must set by hand on each platform when uploading the package. Wording follows
 * the platforms' own settings as documented in docs/platforms.md; the panel shows it in Spanish.
 */
export interface ManualUploadSteps {
  readonly disclosure: string | null;
  readonly visibility: string;
  readonly notes: readonly string[];
}

export function manualUploadSteps(platform: Platform, syntheticMedia: boolean): ManualUploadSteps {
  switch (platform) {
    case "youtube":
      return {
        disclosure: syntheticMedia
          ? "En «Contenido alterado», marca «Sí»: el vídeo usa una voz sintética."
          : null,
        visibility: "Súbelo como «Privado» salvo que el responsable haya autorizado publicarlo.",
        notes: ["Indica «No, no es contenido creado para niños»."],
      };
    case "instagram":
      return {
        disclosure: syntheticMedia
          ? "Activa la etiqueta «Información de IA» antes de compartir: el vídeo usa una voz sintética."
          : null,
        visibility:
          "Instagram no tiene modo privado: publícalo solo con autorización expresa del responsable.",
        notes: ["Súbelo como Reel desde una cuenta profesional."],
      };
    case "tiktok":
      return {
        disclosure: syntheticMedia
          ? "Activa «Contenido generado por IA» en los ajustes de la publicación."
          : null,
        visibility: "Elige «Solo yo» salvo que el responsable haya autorizado publicarlo.",
        notes: ["No añadas marcas de agua ni logotipos al vídeo."],
      };
    case "simulated":
      return { disclosure: null, visibility: "Canal simulado: no hay plataforma real.", notes: [] };
  }
}
