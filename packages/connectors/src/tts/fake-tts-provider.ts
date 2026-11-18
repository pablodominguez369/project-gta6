import { DomainError, err, ok, type Result } from "@gta6/domain";

import type { TtsProvider, TtsRequest, TtsResult } from "./tts-provider";
import { encodeWav, fakeSpeechSamples } from "./wav";

/** Same speaking rate the script QA uses to estimate durations. */
const WORDS_PER_SECOND = 2.6;
const SAMPLE_RATE = 24_000;

export function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}

/**
 * Development voice: a tone per word at the script's speaking rate. No network, no cost, and
 * clearly not a human voice, so a fake render can never be mistaken for a finished piece.
 */
export class FakeTtsProvider implements TtsProvider {
  readonly name = "fake";
  readonly calls: TtsRequest[] = [];

  constructor(private failWith: DomainError | null = null) {}

  failNext(error: DomainError | null): void {
    this.failWith = error;
  }

  maxCostEur(): number {
    return 0;
  }

  synthesize(request: TtsRequest): Promise<Result<TtsResult, DomainError>> {
    this.calls.push(request);
    if (this.failWith) return Promise.resolve(err(this.failWith));
    const words = countWords(request.text);
    const durationMs = Math.max(500, Math.round((words / WORDS_PER_SECOND) * 1000));
    return Promise.resolve(
      ok({
        audio: encodeWav(fakeSpeechSamples(words, durationMs, SAMPLE_RATE), SAMPLE_RATE),
        mimeType: "audio/wav",
        durationMs,
        provider: this.name,
        model: "fake-tone-1",
        characters: request.text.length,
        costEur: 0,
        requestId: null,
      }),
    );
  }
}

/** Used when no TTS is configured: every call is refused, so nothing is narrated or billed. */
export class DisabledTtsProvider implements TtsProvider {
  readonly name = "disabled";

  maxCostEur(): number {
    return 0;
  }

  synthesize(): Promise<Result<TtsResult, DomainError>> {
    return Promise.resolve(
      err(new DomainError("FORBIDDEN", "No text-to-speech provider is configured")),
    );
  }
}
