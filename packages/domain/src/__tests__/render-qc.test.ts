import { describe, expect, it } from "vitest";

import { evaluateRenderQc, type RenderExpectations, type RenderMeasurements } from "../render-qc";

const good: RenderMeasurements = {
  durationMs: 12_000,
  width: 1080,
  height: 1920,
  videoCodec: "h264",
  pixelFormat: "yuv420p",
  audioCodec: "aac",
  sizeBytes: 3_000_000,
  meanVolumeDb: -22,
  blackIntervals: [],
};
const expected: RenderExpectations = { durationMs: 12_200, overflowingScenes: [] };

const failed = (m: Partial<RenderMeasurements>, e: Partial<RenderExpectations> = {}) =>
  evaluateRenderQc({ ...good, ...m }, { ...expected, ...e })
    .checks.filter((c) => !c.ok)
    .map((c) => c.code);

describe("evaluateRenderQc", () => {
  it("passes a correct vertical render", () => {
    expect(evaluateRenderQc(good, expected).passed).toBe(true);
  });

  it("flags every technical problem", () => {
    expect(failed({ width: 1920, height: 1080 })).toEqual(["dimensions"]);
    expect(failed({ pixelFormat: "yuv444p" })).toEqual(["video_codec"]);
    expect(failed({ audioCodec: null, meanVolumeDb: null })).toEqual([
      "audio_present",
      "audio_not_silent",
    ]);
    expect(failed({ meanVolumeDb: -91 })).toEqual(["audio_not_silent"]);
    expect(failed({ durationMs: 14_000 })).toEqual(["duration_matches"]);
    expect(failed({ durationMs: 70_000 }, { durationMs: 70_000 })).toEqual(["duration_limit"]);
    expect(failed({ sizeBytes: 300 * 1024 * 1024 })).toEqual(["file_size"]);
    expect(failed({ blackIntervals: [{ startMs: 0, endMs: 1500 }] })).toEqual(["no_black_frames"]);
    expect(failed({}, { overflowingScenes: [2] })).toEqual(["text_fits"]);
  });

  it("tolerates a short black flash", () => {
    expect(failed({ blackIntervals: [{ startMs: 100, endMs: 600 }] })).toEqual([]);
  });
});
