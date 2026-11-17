import { describe, expect, it } from "vitest";

import { REDACTED, redact, redactString } from "../redact";

// Fake values built at runtime so no secret-looking literal sits in the repository.
const fakeJwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJyb2xlIjoidGVzdCJ9", "c2lnbmF0dXJlLWZha2U"].join(".");
const fakeSbSecret = ["sb", "secret", "fakeValueForTests123"].join("_");

describe("redact", () => {
  it.each(["token", "accessToken", "authorization", "secret", "password", "apiKey", "cookie"])(
    "removes the value of sensitive key %s",
    (key) => {
      expect(redact({ [key]: "visible-value" })).toEqual({ [key]: REDACTED });
    },
  );

  it("handles nested objects and arrays without mutating the input", () => {
    const input = {
      user: { id: "u1", credentials: { refresh_token: "r" } },
      list: [{ secret: 1 }],
    };
    const output = redact(input);

    expect(output).toEqual({
      user: { id: "u1", credentials: REDACTED },
      list: [{ secret: REDACTED }],
    });
    expect(input.user.credentials.refresh_token).toBe("r");
  });

  it("removes JWTs, Supabase secret keys and bearer tokens inside strings", () => {
    const text = `key=${fakeJwt} other=${fakeSbSecret} header=Bearer abc.def-ghi`;
    const output = redactString(text);

    expect(output).not.toContain(fakeJwt);
    expect(output).not.toContain(fakeSbSecret);
    expect(output).not.toContain("abc.def-ghi");
  });

  it("redacts signed URL parameters and URL passwords but keeps the rest", () => {
    const signed =
      "https://project.supabase.co/storage/v1/object/sign/renders/a.mp4?token=abc123&download=1";
    const withPassword = "postgresql://postgres:hunter2@127.0.0.1:54322/postgres";

    const signedOut = redactString(signed);
    const passwordOut = redactString(withPassword);

    expect(signedOut).toContain("/renders/a.mp4");
    expect(signedOut).toContain(`token=${REDACTED}`);
    expect(signedOut).toContain("download=1");
    expect(signedOut).not.toContain("abc123");
    expect(passwordOut).not.toContain("hunter2");
    expect(passwordOut).toContain("127.0.0.1:54322");
  });

  it("serializes errors with redacted message and stack", () => {
    const error = new Error(`upstream rejected ${fakeJwt}`);
    const output = redact({ err: error }) as { err: { type: string; message: string } };

    expect(output.err.type).toBe("Error");
    expect(output.err.message).not.toContain(fakeJwt);
    expect(JSON.stringify(output)).not.toContain(fakeJwt);
  });

  it("survives circular references", () => {
    const node: Record<string, unknown> = { id: 1 };
    node.self = node;

    expect(redact(node)).toEqual({ id: 1, self: "[Circular]" });
  });

  it("leaves harmless values untouched", () => {
    const input = {
      channelId: "c-1",
      count: 3,
      ok: true,
      at: null,
      url: "https://example.com/a?b=1",
    };

    expect(redact(input)).toEqual(input);
  });
});
