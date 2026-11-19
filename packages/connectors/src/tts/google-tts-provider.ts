import { createSign } from "node:crypto";

import { DomainError, err, ok, type ErrorCode, type Result } from "@gta6/domain";
import { z } from "zod";

import type { TtsProvider, TtsRequest, TtsResult } from "./tts-provider";
import { readWavDurationMs } from "./wav";

/**
 * Google Cloud Text-to-Speech, checked against the official documentation on 2026-11-19:
 * - text.synthesize: https://docs.cloud.google.com/text-to-speech/docs/reference/rest/v1/text/synthesize
 *   (`POST /v1/text:synthesize`, scope `cloud-platform`, base64 `audioContent`, LINEAR16 includes
 *   the WAV header).
 * - Quotas: https://docs.cloud.google.com/text-to-speech/quotas (5,000 bytes of input per request).
 * - Chirp 3 HD voices: https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd (es-ES, es-US).
 * - Pricing: https://cloud.google.com/text-to-speech/pricing.
 * - Service-account JWT flow: https://developers.google.com/identity/protocols/oauth2/service-account
 *
 * API keys are not documented for this API, so we authenticate with a service account key (JSON),
 * stored in Supabase Vault and resolved at start-up.
 */
export const GOOGLE_TTS_ENDPOINT = "https://texttospeech.googleapis.com/v1/text:synthesize";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/cloud-platform";
export const GOOGLE_TTS_MAX_INPUT_BYTES = 5_000;
const SAMPLE_RATE = 24_000;

/**
 * List prices in USD per million characters (checked 2026-11-19), used as EUR on purpose: 1 USD is
 * worth less than 1 EUR, so the estimate is on the safe side. The monthly free tier is ignored:
 * we cannot see the account's usage, so the spend gate always assumes the call is billed.
 */
export const GOOGLE_TTS_PRICES_PER_MCHAR: Readonly<Record<string, number>> = {
  "Chirp3-HD": 30,
  Neural2: 16,
  Wavenet: 4,
  Standard: 4,
  Studio: 160,
};
const MAX_PRICE = Math.max(...Object.values(GOOGLE_TTS_PRICES_PER_MCHAR));

/** `es-ES-Chirp3-HD-Achernar` → locale `es-ES`, tier `Chirp3-HD`. Only Spanish voices. */
const VOICE_NAME = /^(es-[A-Z]{2})-([A-Za-z0-9]+(?:-HD)?)-[A-Za-z0-9]+$/;

export function parseGoogleVoice(name: string): { languageCode: string; tier: string } | null {
  const match = VOICE_NAME.exec(name);
  return match?.[1] && match[2] ? { languageCode: match[1], tier: match[2] } : null;
}

function pricePerMChar(tier: string | undefined): number {
  return (tier ? GOOGLE_TTS_PRICES_PER_MCHAR[tier] : undefined) ?? MAX_PRICE;
}

const serviceAccountSchema = z.object({
  type: z.literal("service_account"),
  client_email: z.email(),
  private_key: z.string().includes("PRIVATE KEY"),
  private_key_id: z.string().optional(),
});
export type GoogleServiceAccount = z.infer<typeof serviceAccountSchema>;

/** Parses the downloaded JSON key. Never echoes the content in errors. */
export function parseServiceAccount(json: string): Result<GoogleServiceAccount, DomainError> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return err(new DomainError("VALIDATION_FAILED", "The Google credentials are not JSON"));
  }
  const parsed = serviceAccountSchema.safeParse(raw);
  return parsed.success
    ? ok(parsed.data)
    : err(new DomainError("VALIDATION_FAILED", "The Google credentials are not a service account"));
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
});
const synthesizeResponseSchema = z.object({ audioContent: z.string().min(1) });

export type GoogleTtsFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface GoogleTtsOptions {
  /** Injected in tests; defaults to the global fetch. */
  readonly fetch?: GoogleTtsFetch;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function statusToCode(status: number): ErrorCode {
  if (status === 400) return "VALIDATION_FAILED";
  if (status === 401) return "CREDENTIAL_EXPIRED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  return "EXTERNAL_UNAVAILABLE";
}

/**
 * - No retries here: the job queue retries through the spend gate.
 * - A network failure or timeout of the synthesize call is AMBIGUOUS_EXTERNAL_STATE (it may have
 *   been billed); a failure while getting the token is not, because nothing was synthesized.
 */
export class GoogleTtsProvider implements TtsProvider {
  readonly name = "google";
  private readonly fetch: GoogleTtsFetch;
  private readonly now: () => Date;
  private readonly timeoutMs: number;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly account: GoogleServiceAccount,
    options: GoogleTtsOptions = {},
  ) {
    this.fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  maxCostEur(text: string): number {
    // The voice is not known here: price the worst case.
    return (text.length * MAX_PRICE) / 1_000_000;
  }

  async synthesize(request: TtsRequest): Promise<Result<TtsResult, DomainError>> {
    const voice = parseGoogleVoice(request.providerVoiceId);
    if (!voice) {
      return err(new DomainError("VALIDATION_FAILED", "Unsupported Google voice name"));
    }
    if (Buffer.byteLength(request.text, "utf8") > GOOGLE_TTS_MAX_INPUT_BYTES) {
      return err(new DomainError("VALIDATION_FAILED", "Text is longer than 5,000 bytes"));
    }
    if (request.text.trim().length === 0) {
      return err(new DomainError("VALIDATION_FAILED", "Text is empty"));
    }

    const token = await this.accessToken();
    if (!token.ok) return token;

    let response: Response;
    try {
      response = await this.fetch(GOOGLE_TTS_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token.value}`,
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          input: { text: request.text },
          voice: { languageCode: voice.languageCode, name: request.providerVoiceId },
          audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: SAMPLE_RATE },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      return err(
        new DomainError("AMBIGUOUS_EXTERNAL_STATE", "TTS call outcome unknown", { cause: error }),
      );
    }
    if (!response.ok) {
      if (response.status === 401) this.token = null;
      return err(
        new DomainError(statusToCode(response.status), "TTS provider call failed", {
          details: { status: response.status },
        }),
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return err(new DomainError("EXTERNAL_UNAVAILABLE", "TTS response is not JSON"));
    }
    const parsed = synthesizeResponseSchema.safeParse(body);
    if (!parsed.success) {
      return err(new DomainError("EXTERNAL_UNAVAILABLE", "TTS response has no audio"));
    }
    const audio = new Uint8Array(Buffer.from(parsed.data.audioContent, "base64"));
    const durationMs = readWavDurationMs(audio);
    if (durationMs === null || durationMs <= 0) {
      return err(new DomainError("EXTERNAL_UNAVAILABLE", "TTS audio is not a valid WAV file"));
    }
    return ok({
      audio,
      mimeType: "audio/wav",
      durationMs,
      provider: this.name,
      model: voice.tier,
      characters: request.text.length,
      costEur: (request.text.length * pricePerMChar(voice.tier)) / 1_000_000,
      requestId: response.headers.get("x-goog-request-id"),
    });
  }

  private async accessToken(): Promise<Result<string, DomainError>> {
    const nowMs = this.now().getTime();
    if (this.token && this.token.expiresAt - 60_000 > nowMs) return ok(this.token.value);

    let assertion: string;
    try {
      assertion = this.signedJwt(Math.floor(nowMs / 1000));
    } catch {
      return err(new DomainError("VALIDATION_FAILED", "The Google private key cannot sign"));
    }
    let response: Response;
    try {
      response = await this.fetch(GOOGLE_TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion,
        }).toString(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      return err(
        new DomainError("EXTERNAL_UNAVAILABLE", "Google token endpoint unreachable", {
          cause: error,
        }),
      );
    }
    if (!response.ok) {
      // 400/401 here mean a revoked or wrong key: the owner must create a new one.
      const code =
        response.status === 400 || response.status === 401
          ? "CREDENTIAL_EXPIRED"
          : statusToCode(response.status);
      return err(
        new DomainError(code, "Google token request failed", {
          details: { status: response.status },
        }),
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return err(new DomainError("EXTERNAL_UNAVAILABLE", "Google token response is not JSON"));
    }
    const parsed = tokenResponseSchema.safeParse(body);
    if (!parsed.success) {
      return err(new DomainError("EXTERNAL_UNAVAILABLE", "Google token response is invalid"));
    }
    this.token = {
      value: parsed.data.access_token,
      expiresAt: nowMs + parsed.data.expires_in * 1000,
    };
    return ok(parsed.data.access_token);
  }

  private signedJwt(issuedAt: number): string {
    const header = base64url(
      JSON.stringify({
        alg: "RS256",
        typ: "JWT",
        ...(this.account.private_key_id ? { kid: this.account.private_key_id } : {}),
      }),
    );
    const claims = base64url(
      JSON.stringify({
        iss: this.account.client_email,
        scope: SCOPE,
        aud: GOOGLE_TOKEN_ENDPOINT,
        iat: issuedAt,
        exp: issuedAt + 3600,
      }),
    );
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${claims}`);
    return `${header}.${claims}.${signer.sign(this.account.private_key).toString("base64url")}`;
  }
}
