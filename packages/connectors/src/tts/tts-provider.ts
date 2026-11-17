import type { DomainError, Result } from "@gta6/domain";

/**
 * Contract only (Phase 1). Implementations arrive in Phase 3. A voice can only be used when its
 * license and consent are recorded (rule 5); synthetic-content disclosure is tracked per output.
 */
export interface VoiceLicense {
  readonly provider: string;
  readonly voiceId: string;
  /** Reference to the stored license/consent proof. */
  readonly licenseRef: string;
  /** True only for voices that do not imitate an identifiable person without consent. */
  readonly cloningConsentVerified: boolean;
}

export interface TtsRequest {
  readonly text: string;
  readonly locale: "es-ES" | "es-419";
  readonly voice: VoiceLicense;
}

export interface TtsResult {
  readonly audioRef: string;
  readonly durationMs: number;
  readonly provider: string;
  readonly voiceId: string;
  readonly syntheticDisclosureRequired: boolean;
  readonly estimatedCostEur: number;
}

export interface TtsProvider {
  readonly name: string;
  synthesize(request: TtsRequest): Promise<Result<TtsResult, DomainError>>;
}
