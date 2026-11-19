import { buildStoryboard, scriptDraftSchema } from "@gta6/domain";
import { describe, expect, it } from "vitest";

import { buildRenderArgs } from "../render-plan";

const draft = scriptDraftSchema.parse({
  lines: [
    { kind: "hook", voice: "Hola, esto es una prueba", on_screen: "Prueba" },
    { kind: "cta", voice: "Gracias por escuchar", on_screen: "" },
  ],
});

function args(musicFile: string | null): string[] {
  return buildRenderArgs({
    storyboard: buildStoryboard(draft, [2000, 1500], [null, null]),
    backgrounds: [{ file: "bg.png", kind: "image" }, null],
    voiceFiles: ["voice_0.wav", "voice_1.wav"],
    musicFile,
    assFile: "subs.ass",
    fontsDir: "/fonts",
    output: "master.mp4",
  });
}

function filterGraph(list: string[]): string {
  return list[list.indexOf("-filter_complex") + 1] ?? "";
}

describe("buildRenderArgs", () => {
  // FFmpeg 5.1 failed with "Cannot select channel layout" when the closing silence was a
  // separate lavfi input; it is now generated inside the graph.
  it("generates the closing silence inside the filter graph, not as an input", () => {
    const list = args(null);
    expect(list.filter((arg) => arg.startsWith("anullsrc"))).toHaveLength(0);
    expect(filterGraph(list)).toMatch(/(^|;)anullsrc=r=48000:cl=stereo,atrim=duration=/);
  });

  it("pins the audio output format and channel count", () => {
    const list = args(null);
    expect(filterGraph(list)).toContain(
      "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[aout]",
    );
    expect(list[list.indexOf("-ac") + 1]).toBe("2");
  });

  it("reads the music from the input right after the narration", () => {
    const list = args("music.mp3");
    // 3 visual inputs (2 scenes + closing card) and 2 narration files: music is input 5.
    const inputs = list.flatMap((arg, i) => (arg === "-i" ? [list[i + 1]] : []));
    expect(inputs.indexOf("music.mp3")).toBe(5);
    expect(filterGraph(list)).toContain("[5:a]aresample=48000");
  });
});
