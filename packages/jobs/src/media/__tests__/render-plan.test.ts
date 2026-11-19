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
    // 1 image input (the other scene and the closing card use the brand colour) and 2 narration
    // files: music is input 3.
    const inputs = list.flatMap((arg, i) => (arg === "-i" ? [list[i + 1]] : []));
    expect(inputs).toEqual(["bg.png", "voice_0.wav", "voice_1.wav", "music.mp3"]);
    expect(filterGraph(list)).toContain("[3:a]aresample=48000");
  });

  // Containers report the host's CPUs; without a limit x264 ran out of memory on Railway.
  it("limits encoder and filter threads", () => {
    const list = args(null);
    expect(list[list.indexOf("-threads") + 1]).toBe("2");
    expect(list[list.indexOf("-filter_complex_threads") + 1]).toBe("2");
    expect(list.indexOf("-filter_complex_threads")).toBeLessThan(list.indexOf("-i"));
  });

  // FFmpeg 7 queued every frame of later scenes in memory (SIGKILL on the worker).
  it("reads images as one frame and generates colour and repeats inside the graph", () => {
    const list = args(null);
    expect(list).not.toContain("-loop");
    expect(list).not.toContain("lavfi");
    const graph = filterGraph(list);
    expect(graph).toContain("[0:v]scale=1080:1920");
    expect(graph).toContain("loop=loop=-1:size=1");
    expect(graph.match(/(^|;)color=c=0x1d3557:s=1080x1920:r=30:d=/g)).toHaveLength(2);
  });
});
