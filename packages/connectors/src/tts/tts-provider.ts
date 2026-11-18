import type { DomainError, Result } from "@gta6/domain";

/**
 * Text to speech. Callers check the voice with `evaluateVoice` (license, consent, approval)
 * before every call (rule 5), and every billable call goes through the spend gate.
 */
export interface TtsRequest {
  readonly text: string;
  readonly locale: "es-ES" | "es-419";
  /** The provider's own voice id, from an approved `voices` row. */
  readonly providerVoiceId: string;
}

export interface TtsResult {
  /** Encoded audio. WAV (PCM) or MP3, as reported in `mimeType`. */
  readonly audio: Uint8Array;
  readonly mimeType: "audio/wav" | "audio/mpeg";
  readonly durationMs: number;
  readonly provider: string;
  /** Provider model or engine used, for the manifest. */
  readonly model: string;
  readonly characters: number;
  readonly costEur: number;
  readonly requestId: string | null;
}

export interface TtsProvider {
  readonly name: string;
  /** Upper bound of what one call may cost, checked by the spend gate before calling. */
  maxCostEur(text: string): number;
  synthesize(request: TtsRequest): Promise<Result<TtsResult, DomainError>>;
}
