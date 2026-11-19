import { execFile } from "node:child_process";

import type { RenderMeasurements } from "@gta6/domain";
import { z } from "zod";

/** Upper bound for one FFmpeg run; a 60 s vertical video renders in well under this. */
export const FFMPEG_TIMEOUT_MS = 10 * 60_000;

export interface ProcessResult {
  readonly code: number;
  /** Set when the process was killed (for example SIGKILL when it ran out of memory). */
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs a binary with an argument array (never a shell string), so file names or text can never
 * be interpreted as commands.
 */
export function runProcess(
  binary: string,
  args: readonly string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    execFile(
      binary,
      [...args],
      {
        cwd: options.cwd,
        timeout: options.timeoutMs ?? FFMPEG_TIMEOUT_MS,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
        resolve({ code, signal: error?.signal ?? null, stdout, stderr });
      },
    );
  });
}

export async function ffmpegVersion(ffmpeg = "ffmpeg"): Promise<string> {
  const result = await runProcess(ffmpeg, ["-hide_banner", "-version"], { timeoutMs: 10_000 });
  return result.stdout.split("\n")[0]?.trim() ?? "unknown";
}

const probeSchema = z.object({
  streams: z.array(
    z.object({
      codec_type: z.string(),
      codec_name: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      pix_fmt: z.string().optional(),
    }),
  ),
  format: z.object({ duration: z.string(), size: z.string() }),
});

/** Parses `ffmpeg ... blackdetect ... volumedetect` stderr. */
export function parseAnalysis(stderr: string): {
  blackIntervals: { startMs: number; endMs: number }[];
  meanVolumeDb: number | null;
} {
  const blackIntervals = [...stderr.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map(
    (match) => ({
      startMs: Math.round(Number(match[1]) * 1000),
      endMs: Math.round(Number(match[2]) * 1000),
    }),
  );
  const volume = /mean_volume: (-?[\d.]+|-inf) dB/.exec(stderr)?.[1];
  const meanVolumeDb =
    volume === undefined ? null : volume === "-inf" ? Number.NEGATIVE_INFINITY : Number(volume);
  return { blackIntervals, meanVolumeDb };
}

/** Measures a rendered file with ffprobe and FFmpeg's blackdetect and volumedetect filters. */
export async function measureRender(
  file: string,
  binaries: { ffmpeg: string; ffprobe: string },
): Promise<RenderMeasurements | null> {
  const probe = await runProcess(binaries.ffprobe, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    file,
  ]);
  if (probe.code !== 0) return null;
  let json: unknown;
  try {
    json = JSON.parse(probe.stdout);
  } catch {
    return null;
  }
  const parsed = probeSchema.safeParse(json);
  if (!parsed.success) return null;
  const video = parsed.data.streams.find((s) => s.codec_type === "video");
  const audio = parsed.data.streams.find((s) => s.codec_type === "audio");

  const analysis = await runProcess(binaries.ffmpeg, [
    "-hide_banner",
    "-nostats",
    "-i",
    file,
    "-vf",
    "blackdetect=d=0.5:pix_th=0.10",
    "-af",
    "volumedetect",
    "-f",
    "null",
    "-",
  ]);
  const { blackIntervals, meanVolumeDb } = parseAnalysis(analysis.stderr);

  return {
    durationMs: Math.round(Number(parsed.data.format.duration) * 1000),
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    videoCodec: video?.codec_name ?? "none",
    pixelFormat: video?.pix_fmt ?? "none",
    audioCodec: audio?.codec_name ?? null,
    sizeBytes: Number(parsed.data.format.size),
    meanVolumeDb: audio ? meanVolumeDb : null,
    blackIntervals,
  };
}
