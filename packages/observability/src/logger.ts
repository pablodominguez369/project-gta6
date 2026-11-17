import { pino, type DestinationStream, type Level, type Logger } from "pino";

import { redact, redactString } from "./redact";

export type { Logger } from "pino";

export interface CreateLoggerOptions {
  readonly name: string;
  readonly level?: Level;
  /** Defaults to stdout. Tests pass an in-memory stream. */
  readonly destination?: DestinationStream;
  /** Static fields added to every entry, e.g. { appEnv: "local" }. Redacted too. */
  readonly base?: Readonly<Record<string, unknown>>;
}

/**
 * Structured JSON logger. Every entry (fields, message and errors) goes through `redact`,
 * so tokens, passwords, JWTs and signed URLs never reach the log sink.
 */
export function createLogger(options: CreateLoggerOptions): Logger {
  return pino(
    {
      name: options.name,
      level: options.level ?? "info",
      base: (redact({ ...options.base }) as Record<string, unknown> | undefined) ?? null,
      timestamp: pino.stdTimeFunctions.isoTime,
      // Errors are serialized by `redact` in formatters.log.
      serializers: {},
      formatters: {
        level: (label) => ({ level: label }),
        log: (object) => redact(object) as Record<string, unknown>,
      },
      hooks: {
        logMethod(args, method) {
          const sanitized = args.map((arg) =>
            typeof arg === "string" ? redactString(arg) : arg,
          ) as Parameters<typeof method>;
          method.apply(this, sanitized);
        },
      },
    },
    options.destination,
  );
}

/** Child logger carrying a request id, so one request can be followed across web and worker. */
export function withRequestId(logger: Logger, requestId: string): Logger {
  return logger.child({ requestId });
}
