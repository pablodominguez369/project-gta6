import { END_CARD_MS, FRAME, type Storyboard } from "@gta6/domain";

/** Brand background when a scene has no asset. Not dark enough to count as a black frame. */
export const BRAND_BACKGROUND = "0x1d3557";
export const FPS = 30;
/** Music sits well under the narration. */
export const MUSIC_VOLUME = 0.12;
/** Common loudness target for mobile platforms; verify per platform before Phase 4. */
export const LOUDNESS_LUFS = -14;

export interface PlanBackground {
  readonly file: string;
  readonly kind: "image" | "video";
}

export interface RenderPlanInput {
  readonly storyboard: Storyboard;
  /** Background per scene (same order as the storyboard), or null for the brand colour. */
  readonly backgrounds: readonly (PlanBackground | null)[];
  /** Narration file per scene (same order). */
  readonly voiceFiles: readonly string[];
  readonly musicFile: string | null;
  /** Subtitles file name, relative to the working directory of the FFmpeg run. */
  readonly assFile: string;
  readonly fontsDir: string;
  readonly output: string;
}

const seconds = (ms: number): string => (ms / 1000).toFixed(3);

/**
 * FFmpeg arguments for the master render: one segment per scene plus the closing card, scaled
 * and cropped to 1080x1920, narration with each line's pause, optional music under it, subtitles
 * burned in with libass, loudness normalised, H.264/AAC MP4 with fast start. Pure, so it can be
 * tested and stored in the manifest for reproducibility.
 */
export function buildRenderArgs(input: RenderPlanInput): string[] {
  const { storyboard } = input;
  const args: string[] = ["-hide_banner", "-nostats", "-y"];
  const segments = [
    ...storyboard.scenes.map((scene, index) => ({
      durationMs: scene.endMs - scene.startMs,
      background: input.backgrounds[index] ?? null,
    })),
    { durationMs: END_CARD_MS, background: null },
  ];

  // Inputs 0..S-1: one visual per segment.
  for (const segment of segments) {
    const d = seconds(segment.durationMs);
    if (segment.background?.kind === "image") {
      args.push("-loop", "1", "-framerate", String(FPS), "-t", d, "-i", segment.background.file);
    } else if (segment.background?.kind === "video") {
      args.push("-stream_loop", "-1", "-t", d, "-i", segment.background.file);
    } else {
      args.push(
        "-f",
        "lavfi",
        "-t",
        d,
        "-i",
        `color=c=${BRAND_BACKGROUND}:s=${String(FRAME.width)}x${String(FRAME.height)}:r=${String(FPS)}`,
      );
    }
  }
  // Next inputs: one narration file per scene, then silence for the closing card.
  const voiceBase = segments.length;
  for (const file of input.voiceFiles) args.push("-i", file);
  const silenceIndex = voiceBase + input.voiceFiles.length;
  args.push("-f", "lavfi", "-t", seconds(END_CARD_MS), "-i", "anullsrc=r=48000:cl=stereo");
  const musicIndex = silenceIndex + 1;
  if (input.musicFile) args.push("-stream_loop", "-1", "-i", input.musicFile);

  const filters: string[] = [];
  segments.forEach((segment, i) => {
    filters.push(
      `[${String(i)}:v]scale=${String(FRAME.width)}:${String(FRAME.height)}:force_original_aspect_ratio=increase,` +
        `crop=${String(FRAME.width)}:${String(FRAME.height)},setsar=1,fps=${String(FPS)},format=yuv420p,` +
        `trim=duration=${seconds(segment.durationMs)},setpts=PTS-STARTPTS[v${String(i)}]`,
    );
  });
  filters.push(
    `${segments.map((_, i) => `[v${String(i)}]`).join("")}concat=n=${String(segments.length)}:v=1:a=0[vcat]`,
  );
  filters.push(`[vcat]ass=${input.assFile}:fontsdir=${input.fontsDir}[vout]`);

  storyboard.scenes.forEach((scene, i) => {
    filters.push(
      `[${String(voiceBase + i)}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
        `apad=whole_dur=${seconds(scene.endMs - scene.startMs)},atrim=duration=${seconds(scene.endMs - scene.startMs)},asetpts=PTS-STARTPTS[a${String(i)}]`,
    );
  });
  filters.push(`[${String(silenceIndex)}:a]aformat=sample_fmts=fltp:channel_layouts=stereo[asil]`);
  filters.push(
    `${storyboard.scenes.map((_, i) => `[a${String(i)}]`).join("")}[asil]concat=n=${String(storyboard.scenes.length + 1)}:v=0:a=1[voice]`,
  );
  if (input.musicFile) {
    filters.push(
      `[${String(musicIndex)}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${String(MUSIC_VOLUME)}[music]`,
    );
    filters.push(
      "[voice][music]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix]",
    );
  } else {
    filters.push("[voice]anull[mix]");
  }
  filters.push(`[mix]loudnorm=I=${String(LOUDNESS_LUFS)}:TP=-1.5:LRA=11,aresample=48000[aout]`);

  const totalMs = storyboard.totalMs + END_CARD_MS;
  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(FPS),
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-movflags",
    "+faststart",
    "-t",
    seconds(totalMs),
    input.output,
  );
  return args;
}
