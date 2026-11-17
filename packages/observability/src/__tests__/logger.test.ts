import { describe, expect, it } from "vitest";

import { createLogger, withRequestId } from "../logger";
import { REDACTED } from "../redact";

const fakeJwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJyb2xlIjoidGVzdCJ9", "c2lnbmF0dXJlLWZha2U"].join(".");

function memoryLogger() {
  const lines: string[] = [];
  const logger = createLogger({
    name: "test",
    level: "debug",
    destination: { write: (chunk: string) => lines.push(chunk) },
  });
  const entries = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { logger, lines, entries };
}

describe("createLogger", () => {
  it("writes structured JSON with level label, name and ISO time", () => {
    const { logger, entries } = memoryLogger();
    logger.info({ channelId: "c-1" }, "channel paused");

    const [entry] = entries();
    expect(entry).toMatchObject({
      level: "info",
      name: "test",
      channelId: "c-1",
      msg: "channel paused",
    });
    expect(typeof entry?.time).toBe("string");
  });

  it("redacts token, authorization, secret and signed URLs in fields", () => {
    const { logger, lines } = memoryLogger();
    logger.warn(
      {
        token: "tok-123",
        headers: { authorization: `Bearer ${fakeJwt}` },
        secret: "s3cr3t",
        url: "https://x.supabase.co/storage/v1/object/sign/a.mp4?token=signed-abc",
      },
      "request failed",
    );

    const output = lines.join("");
    expect(output).toContain(REDACTED);
    for (const leaked of ["tok-123", fakeJwt, "s3cr3t", "signed-abc"]) {
      expect(output).not.toContain(leaked);
    }
  });

  it("redacts secrets inside the message and inside errors", () => {
    const { logger, lines } = memoryLogger();
    logger.error({ err: new Error(`bad key ${fakeJwt}`) }, `retrying with ${fakeJwt}`);

    expect(lines.join("")).not.toContain(fakeJwt);
  });

  it("propagates requestId to child loggers", () => {
    const { logger, entries } = memoryLogger();
    withRequestId(logger, "req-42").debug("hello");

    expect(entries()[0]).toMatchObject({ requestId: "req-42", msg: "hello" });
  });
});
