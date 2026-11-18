import type { ScriptDraft, ScriptLineKind } from "./script";

/**
 * Vertical 9:16 frame and the areas platform interfaces cover (profile picture, buttons,
 * description). Text is only placed inside the safe area so nothing is hidden or cut on a phone.
 */
export const FRAME = { width: 1080, height: 1920 } as const;
export const SAFE_AREA = { left: 90, right: 990, top: 250, bottom: 1500 } as const;

/** Caption style used by the template; the wrap limit follows from it. */
export const CAPTION_FONT_SIZE = 64;
/** Conservative average glyph width for a bold sans font, as a fraction of the font size. */
const AVERAGE_GLYPH_WIDTH = 0.6;
export const CAPTION_MAX_CHARS_PER_LINE = Math.floor(
  (SAFE_AREA.right - SAFE_AREA.left) / (CAPTION_FONT_SIZE * AVERAGE_GLYPH_WIDTH),
);
export const CAPTION_MAX_LINES = 2;
/** On-screen headline: larger, so fewer characters fit. */
export const HEADLINE_FONT_SIZE = 72;
export const HEADLINE_MAX_CHARS_PER_LINE = Math.floor(
  (SAFE_AREA.right - SAFE_AREA.left) / (HEADLINE_FONT_SIZE * AVERAGE_GLYPH_WIDTH),
);
export const HEADLINE_MAX_LINES = 3;

export interface Scene {
  readonly index: number;
  readonly kind: ScriptLineKind;
  readonly startMs: number;
  /** Narration of this line (startMs .. startMs + voiceMs), then its pause. */
  readonly voiceMs: number;
  readonly endMs: number;
  readonly voice: string;
  readonly onScreen: string;
  /** Asset shown behind this scene, or null for the brand background. */
  readonly backgroundAssetId: string | null;
}

export interface Storyboard {
  readonly scenes: readonly Scene[];
  readonly totalMs: number;
}

/**
 * Lays the script lines end to end. `voiceDurationsMs[i]` is the narration length of line i
 * (from the TTS, or an estimate for the preview); each line's pause follows it.
 */
export function buildStoryboard(
  draft: ScriptDraft,
  voiceDurationsMs: readonly number[],
  backgrounds: readonly (string | null)[],
): Storyboard {
  let cursor = 0;
  const scenes = draft.lines.map((line, index): Scene => {
    const voiceMs = Math.max(0, Math.round(voiceDurationsMs[index] ?? 0));
    const startMs = cursor;
    const endMs = startMs + voiceMs + line.pause_ms;
    cursor = endMs;
    return {
      index,
      kind: line.kind,
      startMs,
      voiceMs,
      endMs,
      voice: line.voice,
      onScreen: line.on_screen,
      backgroundAssetId: backgrounds[index] ?? null,
    };
  });
  return { scenes, totalMs: cursor };
}

/** Narration estimate used before the TTS runs (same rate as the script QA). */
export function estimateVoiceMs(text: string, wordsPerSecond = 2.6): number {
  const words = text.split(/\s+/).filter((w) => w.length > 0).length;
  return Math.max(500, Math.round((words / wordsPerSecond) * 1000));
}

/**
 * Greedy word wrap. A single word longer than the limit is split, so no line ever exceeds
 * `maxChars` (the template can then guarantee nothing is cut).
 */
export function wrapText(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const raw of text.split(/\s+/).filter((w) => w.length > 0)) {
    let word = raw;
    while (word.length > maxChars) {
      if (current) {
        lines.push(current);
        current = "";
      }
      lines.push(word.slice(0, maxChars));
      word = word.slice(maxChars);
    }
    if (!word) continue;
    if (!current) current = word;
    else if (current.length + 1 + word.length <= maxChars) current = `${current} ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export interface CaptionCue {
  readonly startMs: number;
  readonly endMs: number;
  /** One or two lines, each within CAPTION_MAX_CHARS_PER_LINE. */
  readonly lines: readonly string[];
}

/**
 * Captions synchronised with the narration: each scene's text is wrapped and grouped in cues of
 * at most two lines, timed in proportion to their characters within the scene's voice time.
 */
export function buildCaptions(storyboard: Storyboard): CaptionCue[] {
  const cues: CaptionCue[] = [];
  for (const scene of storyboard.scenes) {
    const wrapped = wrapText(scene.voice, CAPTION_MAX_CHARS_PER_LINE);
    const groups: string[][] = [];
    for (let i = 0; i < wrapped.length; i += CAPTION_MAX_LINES) {
      groups.push(wrapped.slice(i, i + CAPTION_MAX_LINES));
    }
    const totalChars = groups.reduce((sum, group) => sum + group.join(" ").length, 0);
    let cursor = scene.startMs;
    groups.forEach((group, index) => {
      const share = totalChars > 0 ? group.join(" ").length / totalChars : 1;
      const endMs =
        index === groups.length - 1
          ? scene.startMs + scene.voiceMs
          : cursor + Math.round(scene.voiceMs * share);
      if (endMs > cursor) cues.push({ startMs: cursor, endMs, lines: group });
      cursor = endMs;
    });
  }
  return cues;
}

/** Text overlays that would not fit in the safe area (QC "texto cortado"). */
export function findOverflowingText(storyboard: Storyboard): number[] {
  return storyboard.scenes
    .filter(
      (scene) => wrapText(scene.onScreen, HEADLINE_MAX_CHARS_PER_LINE).length > HEADLINE_MAX_LINES,
    )
    .map((scene) => scene.index);
}

function assTime(ms: number): string {
  const cs = Math.round(ms / 10);
  const h = Math.floor(cs / 360_000);
  const m = Math.floor((cs % 360_000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${String(h)}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

/** ASS escapes: braces start override blocks and a backslash starts a tag. */
function assText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/[{}]/g, "");
}

export interface AssOptions {
  readonly font: string;
  /** Text shown for the whole video at the top, e.g. "Voz generada con IA". */
  readonly disclosure: string | null;
  /** Own brand text (never another platform's watermark). */
  readonly brand: string;
}

/**
 * Subtitles in Advanced SubStation Alpha, rendered by FFmpeg/libass: captions, the per-scene
 * headline, the brand and the synthetic-voice disclosure, all inside the safe area.
 */
export function buildAss(storyboard: Storyboard, options: AssOptions): string {
  const marginH = SAFE_AREA.left;
  const captionMarginV = FRAME.height - SAFE_AREA.bottom;
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${String(FRAME.width)}`,
    `PlayResY: ${String(FRAME.height)}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Caption,${options.font},${String(CAPTION_FONT_SIZE)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,5,0,2,${String(marginH)},${String(marginH)},${String(captionMarginV)},1`,
    `Style: Headline,${options.font},${String(HEADLINE_FONT_SIZE)},&H0000E5FF,&H0000E5FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,6,0,8,${String(marginH)},${String(marginH)},${String(SAFE_AREA.top + 120)},1`,
    `Style: Small,${options.font},40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,0,8,${String(marginH)},${String(marginH)},${String(SAFE_AREA.top)},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const events: string[] = [];
  const end = assTime(storyboard.totalMs);
  const top = [options.brand, options.disclosure].filter(Boolean).join(" · ");
  if (top) events.push(`Dialogue: 2,${assTime(0)},${end},Small,,0,0,0,,${assText(top)}`);
  for (const scene of storyboard.scenes) {
    if (!scene.onScreen) continue;
    const text = wrapText(scene.onScreen, HEADLINE_MAX_CHARS_PER_LINE)
      .slice(0, HEADLINE_MAX_LINES)
      .map(assText)
      .join("\\N");
    events.push(
      `Dialogue: 1,${assTime(scene.startMs)},${assTime(scene.endMs)},Headline,,0,0,0,,${text}`,
    );
  }
  for (const cue of buildCaptions(storyboard)) {
    events.push(
      `Dialogue: 0,${assTime(cue.startMs)},${assTime(cue.endMs)},Caption,,0,0,0,,${cue.lines.map(assText).join("\\N")}`,
    );
  }
  return `${[...header, ...events].join("\n")}\n`;
}

/** Must match `public.media_project_status`. */
export const MEDIA_PROJECT_STATUSES = [
  "draft",
  "queued",
  "rendering",
  "rendered",
  "blocked",
  "failed",
] as const;
export type MediaProjectStatus = (typeof MEDIA_PROJECT_STATUSES)[number];
