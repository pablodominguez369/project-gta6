import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FakeTtsProvider } from "@gta6/connectors";
import {
  buildAss,
  buildEndCard,
  buildStoryboard,
  evaluateRenderQc,
  findOverflowingText,
  scriptDraftSchema,
  videoDurationMs,
} from "@gta6/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { measureRender, runProcess } from "../ffmpeg";
import { buildRenderArgs } from "../render-plan";

// Needs ffmpeg/ffprobe with libass and the DejaVu fonts (installed in CI and the worker image).
const FONTS_DIR = process.env.RENDER_FONTS_DIR ?? "/usr/share/fonts/truetype/dejavu";
let dir = "";

beforeAll(async () => {
  // RENDER_TEST_DIR keeps the output for a visual check.
  dir = process.env.RENDER_TEST_DIR ?? (await mkdtemp(join(tmpdir(), "render-plan-")));
});

afterAll(async () => {
  if (!process.env.RENDER_TEST_DIR) await rm(dir, { recursive: true, force: true });
});

describe("buildRenderArgs with the real FFmpeg", () => {
  it("renders a vertical video that passes the technical QC", async () => {
    const draft = scriptDraftSchema.parse({
      lines: [
        {
          kind: "hook",
          voice: "Por fin hay noticias del juego",
          on_screen: "¡Noticias!",
          pause_ms: 200,
        },
        { kind: "body", voice: "Según el estudio, la fecha se anunciará pronto", on_screen: "" },
      ],
    });
    const tts = new FakeTtsProvider();
    const voiceFiles: string[] = [];
    const durations: number[] = [];
    for (const [i, line] of draft.lines.entries()) {
      const result = await tts.synthesize({
        text: line.voice,
        locale: "es-ES",
        providerVoiceId: "fake",
      });
      if (!result.ok) throw new Error("tts");
      const file = `voice_${String(i)}.wav`;
      await writeFile(join(dir, file), result.value.audio);
      voiceFiles.push(file);
      durations.push(result.value.durationMs);
    }
    // A small image background for the first scene, generated with FFmpeg.
    const bg = await runProcess(
      "ffmpeg",
      [
        "-hide_banner",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=s=640x360:d=1",
        "-frames:v",
        "1",
        "bg.png",
      ],
      { cwd: dir },
    );
    expect(bg.code).toBe(0);

    const storyboard = buildStoryboard(draft, durations, []);
    await writeFile(
      join(dir, "subs.ass"),
      buildAss(storyboard, {
        font: "DejaVu Sans",
        disclosure: "Voz generada con IA",
        brand: "Canal",
        endCard: buildEndCard(["Fondo: equipo"]),
      }),
    );
    const args = buildRenderArgs({
      storyboard,
      backgrounds: [{ file: "bg.png", kind: "image" }, null],
      voiceFiles,
      musicFile: null,
      assFile: "subs.ass",
      fontsDir: FONTS_DIR,
      output: "master.mp4",
    });
    const result = await runProcess("ffmpeg", args, { cwd: dir });
    expect(result.stderr.slice(-2000)).not.toMatch(/Error|Invalid/);
    expect(result.code).toBe(0);

    const measured = await measureRender(join(dir, "master.mp4"), {
      ffmpeg: "ffmpeg",
      ffprobe: "ffprobe",
    });
    if (!measured) throw new Error("probe failed");
    const report = evaluateRenderQc(measured, {
      durationMs: videoDurationMs(storyboard),
      overflowingScenes: findOverflowingText(storyboard),
    });
    expect(report.checks.filter((c) => !c.ok)).toEqual([]);
  });
});
