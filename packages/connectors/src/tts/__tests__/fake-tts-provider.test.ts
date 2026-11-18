import { DomainError } from "@gta6/domain";
import { describe, expect, it } from "vitest";

import { DisabledTtsProvider, FakeTtsProvider } from "../fake-tts-provider";

const request = {
  text: "El estudio ha anunciado la fecha de lanzamiento",
  locale: "es-ES",
  providerVoiceId: "fake-1",
} as const;

describe("FakeTtsProvider", () => {
  it("returns a playable WAV whose length matches the speaking rate", async () => {
    const result = await new FakeTtsProvider().synthesize(request);
    if (!result.ok) throw new Error("expected ok");
    const { audio, durationMs } = result.value;
    expect(durationMs).toBe(Math.round((8 / 2.6) * 1000));
    expect(new TextDecoder().decode(audio.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(audio.slice(8, 12))).toBe("WAVE");
    const view = new DataView(audio.buffer);
    const sampleRate = view.getUint32(24, true);
    const dataBytes = view.getUint32(40, true);
    expect(Math.round((dataBytes / 2 / sampleRate) * 1000)).toBe(durationMs);
    expect(result.value.costEur).toBe(0);
  });

  it("can be told to fail", async () => {
    const tts = new FakeTtsProvider(new DomainError("RATE_LIMITED", "slow down"));
    const result = await tts.synthesize(request);
    expect(result.ok ? null : result.error.code).toBe("RATE_LIMITED");
    expect(tts.calls).toHaveLength(1);
  });
});

describe("DisabledTtsProvider", () => {
  it("refuses every call", async () => {
    const result = await new DisabledTtsProvider().synthesize();
    expect(result.ok ? null : result.error.code).toBe("FORBIDDEN");
  });
});
