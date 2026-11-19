import { END_CARD_MS, FRAME, type Storyboard } from "@gta6/domain";

/** Brand background when a scene has no asset. Not dark enough to count as a black frame. */
export const BRAND_BACKGROUND = "0x1d3557";
export const FPS = 30;
/** Music sits well under the narration. */
export const MUSIC_VOLUME = 0.12;
/**
 * Encoder threads. Containers often report the host's CPU count, and x264 would then keep dozens
 * of 1080x1920 frames in flight: the worker on Railway was killed (out of memory) mid-render.
 */
export const ENCODER_THREADS = 2;
/**
 * Still images are scaled this much larger than the frame and slowly panned across the scene
 * (a "Ken Burns" move), so a photo never looks frozen. A moving crop is cheap, unlike a
 * per-frame zoom, which matters on the worker's small CPU and memory budget.
 */
export const PAN_SCALE = 1.1;
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
 * Moving crop of a still image: diagonal pan over the scene's duration, alternating direction
 * from one scene to the next. FFmpeg evaluates crop's x/y per frame and keeps them in bounds.
 */
export function panCrop(segmentIndex: number, durationSeconds: string): string {
  const progress = segmentIndex % 2 === 0 ? `t/${durationSeconds}` : `(1-t/${durationSeconds})`;
  return (
    `crop=${String(FRAME.width)}:${String(FRAME.height)}:` +
    `x='(iw-ow)*${progress}':y='(ih-oh)*${progress}'`
  );
}

/**
 * FFmpeg arguments for the master render: one segment per scene plus the closing card, scaled
 * and cropped to 1080x1920, narration with each line's pause, optional music under it, subtitles
 * burned in with libass, loudness normalised, H.264/AAC MP4 with fast start. Pure, so it can be
 * tested and stored in the manifest for reproducibility.
 */
export function buildRenderArgs(input: RenderPlanInput): string[] {
  const { storyboard } = input;
  const args: string[] = [
    "-hide_banner",
    "-nostats",
    "-y",
    "-filter_complex_threads",
    String(ENCODER_THREADS),
  ];
  const segments = [
    ...storyboard.scenes.map((scene, index) => ({
      durationMs: scene.endMs - scene.startMs,
      background: input.backgrounds[index] ?? null,
    })),
    { durationMs: END_CARD_MS, background: null },
  ];

  // Visual inputs. FFmpeg 7 decodes every input ahead of time, so a looped image or a lavfi
  // colour input queues every frame of a later scene in memory until concat reaches it (the
  // worker was killed with SIGKILL). Images are therefore read as a single frame and repeated
  // inside the graph with `loop`, and the brand colour is a graph source: both only produce
  // frames when concat asks for them. Video backgrounds still need a real input.
  const size = `${String(FRAME.width)}x${String(FRAME.height)}`;
  const fit =
    `scale=${String(FRAME.width)}:${String(FRAME.height)}:force_original_aspect_ratio=increase,` +
    `crop=${String(FRAME.width)}:${String(FRAME.height)},setsar=1`;
  const panWidth = Math.round(FRAME.width * PAN_SCALE);
  const panHeight = Math.round(FRAME.height * PAN_SCALE);
  const panFit =
    `scale=${String(panWidth)}:${String(panHeight)}:force_original_aspect_ratio=increase,` +
    `crop=${String(panWidth)}:${String(panHeight)},setsar=1`;
  const filters: string[] = [];
  let nextInput = 0;
  segments.forEach((segment, i) => {
    const d = seconds(segment.durationMs);
    const out = `trim=duration=${d},setpts=PTS-STARTPTS[v${String(i)}]`;
    if (segment.background?.kind === "image") {
      args.push("-i", segment.background.file);
      filters.push(
        `[${String(nextInput)}:v]${panFit},format=yuv420p,loop=loop=-1:size=1,` +
          `setpts=N/(${String(FPS)}*TB),fps=${String(FPS)},${panCrop(i, d)},${out}`,
      );
      nextInput += 1;
    } else if (segment.background?.kind === "video") {
      args.push("-stream_loop", "-1", "-t", d, "-i", segment.background.file);
      filters.push(`[${String(nextInput)}:v]${fit},fps=${String(FPS)},format=yuv420p,${out}`);
      nextInput += 1;
    } else {
      filters.push(
        `color=c=${BRAND_BACKGROUND}:s=${size}:r=${String(FPS)}:d=${d},setsar=1,format=yuv420p,${out}`,
      );
    }
  });
  // Next inputs: one narration file per scene, then the optional music. The closing card's
  // silence is generated inside the filter graph: as a separate lavfi input, FFmpeg 5.1 (Debian
  // 12) re-initialised the graph on its first frame and then failed to negotiate the channel
  // layout of the AAC output ("Cannot select channel layout").
  const voiceBase = nextInput;
  for (const file of input.voiceFiles) args.push("-i", file);
  const musicIndex = voiceBase + input.voiceFiles.length;
  if (input.musicFile) args.push("-stream_loop", "-1", "-i", input.musicFile);

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
  filters.push(
    `anullsrc=r=48000:cl=stereo,atrim=duration=${seconds(END_CARD_MS)},aformat=sample_fmts=fltp:channel_layouts=stereo[asil]`,
  );
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
  // The output format is pinned (rate, sample format and layout) so the encoder never has to
  // negotiate it.
  filters.push(
    `[mix]loudnorm=I=${String(LOUDNESS_LUFS)}:TP=-1.5:LRA=11,aresample=48000,` +
      `aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[aout]`,
  );

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
    "veryfast",
    "-threads",
    String(ENCODER_THREADS),
    "-rc-lookahead",
    "20",
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
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    "-t",
    seconds(totalMs),
    input.output,
  );
  return args;
}
