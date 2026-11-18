import {
  PLATFORMS,
  RIGHTS_STATUS_LABELS,
  RIGHTS_STATUSES,
  type AssetKind,
  type AssetOrigin,
} from "@gta6/domain";

export const ASSET_KIND_LABELS: Readonly<Record<AssetKind, string>> = {
  image: "Imagen",
  video: "Vídeo",
  audio: "Audio",
  music: "Música",
  font: "Tipografía",
  voice: "Voz",
};

export const ASSET_ORIGIN_LABELS: Readonly<Record<AssetOrigin, string>> = {
  original_work: "Creado por nosotros",
  ai_generated: "Generado con IA (uso comercial permitido)",
  own_capture: "Captura propia del juego (necesita permiso)",
  official: "Material oficial: tráiler, arte, capturas (necesita permiso)",
  licensed: "Banco de imágenes o biblioteca con licencia",
};

export const ASSET_KIND_OPTIONS = Object.entries(ASSET_KIND_LABELS).map(([value, label]) => ({
  value,
  label,
}));
export const ASSET_ORIGIN_OPTIONS = Object.entries(ASSET_ORIGIN_LABELS).map(([value, label]) => ({
  value,
  label,
}));
export const RIGHTS_STATUS_OPTIONS = RIGHTS_STATUSES.map((value) => ({
  value,
  label: RIGHTS_STATUS_LABELS[value],
}));
export const PLATFORM_OPTIONS = PLATFORMS.filter((p) => p !== "simulated").map((value) => ({
  value,
  label: value === "youtube" ? "YouTube" : value === "instagram" ? "Instagram" : "TikTok",
}));

/** Folder for new uploads; the file name is random so users cannot overwrite each other. */
export function assetStoragePath(id: string, extension: string): string {
  return `assets/${id}.${extension}`;
}

export const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "font/ttf": "ttf",
  "font/otf": "otf",
};
