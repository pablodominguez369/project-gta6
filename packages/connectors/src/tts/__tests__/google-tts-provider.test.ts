import { createVerify, generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { SecretStore } from "../../secrets/secret-store";
import { createTtsProvider } from "../create-tts-provider";
import {
  GOOGLE_TOKEN_ENDPOINT,
  GOOGLE_TTS_ENDPOINT,
  GoogleTtsProvider,
  parseGoogleVoice,
  parseServiceAccount,
  type GoogleServiceAccount,
  type GoogleTtsFetch,
} from "../google-tts-provider";
import { encodeWav, readWavDurationMs } from "../wav";
import { ok, err, DomainError } from "@gta6/domain";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const account: GoogleServiceAccount = {
  type: "service_account",
  client_email: "tts@example-project.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  private_key_id: "key-1",
};

const VOICE = "es-ES-Chirp3-HD-Achernar";
const oneSecondWav = encodeWav(new Int16Array(24_000), 24_000);

interface Call {
  url: string;
  init: RequestInit;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function fakeGoogle(
  synth: () => Response | Promise<Response> = () =>
    json(
      200,
      { audioContent: Buffer.from(oneSecondWav).toString("base64") },
      {
        "x-goog-request-id": "req-1",
      },
    ),
  token: () => Response = () => json(200, { access_token: "tok-1", expires_in: 3600 }),
): { fetch: GoogleTtsFetch; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (url === GOOGLE_TOKEN_ENDPOINT) return token();
      if (url === GOOGLE_TTS_ENDPOINT) return synth();
      throw new Error(`unexpected ${url}`);
    },
  };
}

const request = {
  text: "Hola, esto es una prueba.",
  locale: "es-ES" as const,
  providerVoiceId: VOICE,
};

describe("parseGoogleVoice", () => {
  it("reads the locale and tier of Spanish voices", () => {
    expect(parseGoogleVoice("es-ES-Chirp3-HD-Achernar")).toEqual({
      languageCode: "es-ES",
      tier: "Chirp3-HD",
    });
    expect(parseGoogleVoice("es-US-Neural2-A")).toEqual({ languageCode: "es-US", tier: "Neural2" });
  });

  it("rejects other languages and malformed names", () => {
    expect(parseGoogleVoice("en-US-Chirp3-HD-Kore")).toBeNull();
    expect(parseGoogleVoice("es-ES")).toBeNull();
    expect(parseGoogleVoice("es-ES-Chirp3-HD-Ach ernar")).toBeNull();
  });
});

describe("parseServiceAccount", () => {
  it("accepts a service account key", () => {
    expect(parseServiceAccount(JSON.stringify(account)).ok).toBe(true);
  });

  it("rejects anything else without echoing the content", () => {
    const notJson = parseServiceAccount("secret-value-not-json");
    expect(notJson.ok).toBe(false);
    if (!notJson.ok) expect(notJson.error.message).not.toContain("secret-value");
    const wrongType = parseServiceAccount(JSON.stringify({ ...account, type: "authorized_user" }));
    expect(wrongType.ok).toBe(false);
  });
});

describe("GoogleTtsProvider", () => {
  it("gets a token with a signed JWT and synthesizes a WAV", async () => {
    const google = fakeGoogle();
    const tts = new GoogleTtsProvider(account, {
      fetch: google.fetch,
      now: () => new Date("2026-11-19T10:00:00Z"),
    });
    const result = await tts.synthesize(request);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mimeType).toBe("audio/wav");
    expect(result.value.durationMs).toBe(1000);
    expect(result.value.model).toBe("Chirp3-HD");
    expect(result.value.provider).toBe("google");
    expect(result.value.requestId).toBe("req-1");
    expect(result.value.costEur).toBeCloseTo((request.text.length * 30) / 1_000_000);

    const [tokenCall, synthCall] = google.calls;
    const form = new URLSearchParams(tokenCall?.init.body as string);
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const [header, claims, signature] = (form.get("assertion") ?? "").split(".");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header ?? ""}.${claims ?? ""}`);
    expect(verifier.verify(publicKey, Buffer.from(signature ?? "", "base64url"))).toBe(true);
    expect(JSON.parse(Buffer.from(header ?? "", "base64url").toString())).toEqual({
      alg: "RS256",
      typ: "JWT",
      kid: "key-1",
    });
    const claimSet = JSON.parse(Buffer.from(claims ?? "", "base64url").toString()) as Record<
      string,
      unknown
    >;
    expect(claimSet).toMatchObject({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: GOOGLE_TOKEN_ENDPOINT,
    });
    expect(Number(claimSet.exp) - Number(claimSet.iat)).toBe(3600);

    const headers = synthCall?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer tok-1");
    expect(JSON.parse(synthCall?.init.body as string)).toEqual({
      input: { text: request.text },
      voice: { languageCode: "es-ES", name: VOICE },
      audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: 24_000 },
    });
  });

  it("reuses the token until shortly before it expires", async () => {
    const google = fakeGoogle();
    let now = new Date("2026-11-19T10:00:00Z");
    const tts = new GoogleTtsProvider(account, { fetch: google.fetch, now: () => now });
    await tts.synthesize(request);
    await tts.synthesize(request);
    expect(google.calls.filter((call) => call.url === GOOGLE_TOKEN_ENDPOINT)).toHaveLength(1);
    now = new Date("2026-11-19T10:59:30Z");
    await tts.synthesize(request);
    expect(google.calls.filter((call) => call.url === GOOGLE_TOKEN_ENDPOINT)).toHaveLength(2);
  });

  it("refuses unsupported voices, empty and over-long text without calling Google", async () => {
    const google = fakeGoogle();
    const tts = new GoogleTtsProvider(account, { fetch: google.fetch });
    const voice = await tts.synthesize({ ...request, providerVoiceId: "en-US-Chirp3-HD-Kore" });
    const empty = await tts.synthesize({ ...request, text: "   " });
    const long = await tts.synthesize({ ...request, text: "ñ".repeat(2_501) });
    for (const result of [voice, empty, long]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
    }
    expect(google.calls).toHaveLength(0);
  });

  it("reports a lost synthesize call as ambiguous (it may have been billed)", async () => {
    const google = fakeGoogle(() => Promise.reject(new TypeError("socket hang up")));
    const tts = new GoogleTtsProvider(account, { fetch: google.fetch });
    const result = await tts.synthesize(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AMBIGUOUS_EXTERNAL_STATE");
  });

  it("maps HTTP errors to domain codes", async () => {
    const cases: [number, string][] = [
      [400, "VALIDATION_FAILED"],
      [401, "CREDENTIAL_EXPIRED"],
      [403, "FORBIDDEN"],
      [429, "RATE_LIMITED"],
      [503, "EXTERNAL_UNAVAILABLE"],
    ];
    for (const [status, code] of cases) {
      const google = fakeGoogle(() => json(status, { error: { message: "no" } }));
      const tts = new GoogleTtsProvider(account, { fetch: google.fetch });
      const result = await tts.synthesize(request);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(code);
    }
  });

  it("treats a rejected key as expired credentials and an unreachable token endpoint as unavailable", async () => {
    const rejected = fakeGoogle(undefined, () => json(400, { error: "invalid_grant" }));
    const first = await new GoogleTtsProvider(account, { fetch: rejected.fetch }).synthesize(
      request,
    );
    expect(!first.ok && first.error.code).toBe("CREDENTIAL_EXPIRED");

    const down: GoogleTtsFetch = () => Promise.reject(new TypeError("offline"));
    const second = await new GoogleTtsProvider(account, { fetch: down }).synthesize(request);
    expect(!second.ok && second.error.code).toBe("EXTERNAL_UNAVAILABLE");
  });

  it("rejects a response without valid WAV audio", async () => {
    const google = fakeGoogle(() =>
      json(200, { audioContent: Buffer.from("not audio").toString("base64") }),
    );
    const result = await new GoogleTtsProvider(account, { fetch: google.fetch }).synthesize(
      request,
    );
    expect(!result.ok && result.error.code).toBe("EXTERNAL_UNAVAILABLE");
  });

  it("prices the worst case before calling", () => {
    const tts = new GoogleTtsProvider(account, { fetch: fakeGoogle().fetch });
    expect(tts.maxCostEur("x".repeat(1_000_000))).toBe(160);
  });
});

describe("readWavDurationMs", () => {
  it("reads the duration and skips extra chunks", () => {
    expect(readWavDurationMs(encodeWav(new Int16Array(12_000), 24_000))).toBe(500);
    const plain = encodeWav(new Int16Array(24_000), 24_000);
    // Insert a LIST chunk between fmt and data, as some encoders do.
    const list = new Uint8Array([0x4c, 0x49, 0x53, 0x54, 4, 0, 0, 0, 1, 2, 3, 4]);
    const withList = new Uint8Array(plain.length + list.length);
    withList.set(plain.subarray(0, 36), 0);
    withList.set(list, 36);
    withList.set(plain.subarray(36), 36 + list.length);
    expect(readWavDurationMs(withList)).toBe(1000);
  });

  it("returns null for anything that is not WAV", () => {
    expect(readWavDurationMs(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(readWavDurationMs(new TextEncoder().encode("RIFF....WAVEjunk"))).toBeNull();
  });
});

describe("createTtsProvider", () => {
  const store = (value: string | null): SecretStore => ({
    schemes: ["vault"],
    resolve: () =>
      Promise.resolve(value === null ? err(new DomainError("NOT_FOUND", "missing")) : ok(value)),
  });

  it("builds Google from the stored service account key", async () => {
    const result = await createTtsProvider(
      { provider: "google", credentialsRef: "vault://x" },
      store(JSON.stringify(account)),
    );
    expect(result.ok && result.value.name).toBe("google");
  });

  it("fails safely without a reference, a secret or a valid key", async () => {
    const missingRef = await createTtsProvider({ provider: "google" }, store("{}"));
    const missingSecret = await createTtsProvider(
      { provider: "google", credentialsRef: "vault://x" },
      store(null),
    );
    const badKey = await createTtsProvider(
      { provider: "google", credentialsRef: "vault://x" },
      store("{}"),
    );
    expect(missingRef.ok || missingSecret.ok || badKey.ok).toBe(false);
  });

  it("keeps disabled and fake as before", async () => {
    const disabled = await createTtsProvider({ provider: "disabled" }, store(null));
    const fake = await createTtsProvider({ provider: "fake" }, store(null));
    expect(disabled.ok && disabled.value.name).toBe("disabled");
    expect(fake.ok && fake.value.name).toBe("fake");
  });
});
