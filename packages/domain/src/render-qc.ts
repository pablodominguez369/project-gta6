import { FRAME } from "./storyboard";

/** What the worker measured on the rendered file (ffprobe + FFmpeg filters). */
export interface RenderMeasurements {
  readonly durationMs: number;
  readonly width: number;
  readonly height: number;
  readonly videoCodec: string;
  readonly pixelFormat: string;
  readonly audioCodec: string | null;
  readonly sizeBytes: number;
  /** Mean loudness of the audio track in dBFS, or null when there is no audio. */
  readonly meanVolumeDb: number | null;
  /** Intervals detected as black frames. */
  readonly blackIntervals: readonly { readonly startMs: number; readonly endMs: number }[];
}

export interface RenderExpectations {
  readonly durationMs: number;
  /** Scenes whose on-screen text would be cut (findOverflowingText). */
  readonly overflowingScenes: readonly number[];
}

export const RENDER_QC_CODES = [
  "dimensions",
  "video_codec",
  "audio_present",
  "audio_not_silent",
  "duration_matches",
  "duration_limit",
  "file_size",
  "no_black_frames",
  "text_fits",
] as const;
export type RenderQcCode = (typeof RENDER_QC_CODES)[number];

export const RENDER_QC_MESSAGES: Readonly<Record<RenderQcCode, string>> = {
  dimensions: "El vídeo es vertical 1080x1920.",
  video_codec: "Vídeo H.264 en yuv420p (compatible con móviles).",
  audio_present: "Tiene pista de audio AAC.",
  audio_not_silent: "El audio no está en silencio.",
  duration_matches: "La duración coincide con el guion.",
  duration_limit: "Dura 60 s o menos (más el cierre).",
  file_size: "Pesa menos de 200 MB.",
  no_black_frames: "No hay tramos en negro de más de 1 s.",
  text_fits: "Ningún texto en pantalla se corta.",
};

/** 60 s of content plus the closing card. */
export const MAX_VIDEO_MS = 60_000 + 2_500;
export const MAX_RENDER_BYTES = 200 * 1024 * 1024;
const DURATION_TOLERANCE_MS = 500;
const MAX_BLACK_MS = 1_000;
/** Below this the track is effectively silent. */
const SILENCE_DB = -60;

export interface RenderQcReport {
  readonly version: 1;
  readonly passed: boolean;
  readonly checks: readonly { readonly code: RenderQcCode; readonly ok: boolean }[];
  readonly measurements: RenderMeasurements;
}

/**
 * Technical QC of a render (spec 4.3 step 6). Pure: the worker measures, this decides. Any
 * failed check fails the render; nothing is fixed automatically.
 */
export function evaluateRenderQc(
  measured: RenderMeasurements,
  expected: RenderExpectations,
): RenderQcReport {
  const results: Record<RenderQcCode, boolean> = {
    dimensions: measured.width === FRAME.width && measured.height === FRAME.height,
    video_codec: measured.videoCodec === "h264" && measured.pixelFormat === "yuv420p",
    audio_present: measured.audioCodec === "aac",
    audio_not_silent: measured.meanVolumeDb !== null && measured.meanVolumeDb > SILENCE_DB,
    duration_matches: Math.abs(measured.durationMs - expected.durationMs) <= DURATION_TOLERANCE_MS,
    duration_limit: measured.durationMs <= MAX_VIDEO_MS + DURATION_TOLERANCE_MS,
    file_size: measured.sizeBytes > 0 && measured.sizeBytes <= MAX_RENDER_BYTES,
    no_black_frames: measured.blackIntervals.every((i) => i.endMs - i.startMs <= MAX_BLACK_MS),
    text_fits: expected.overflowingScenes.length === 0,
  };
  const checks = RENDER_QC_CODES.map((code) => ({ code, ok: results[code] }));
  return { version: 1, passed: checks.every((c) => c.ok), checks, measurements: measured };
}
