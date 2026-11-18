/**
 * Stable, machine-readable error codes. Add new codes here; never reuse or rename one,
 * because codes are persisted (job_runs.error_code, publications.error_code) and audited.
 */
export const ERROR_CODES = [
  "VALIDATION_FAILED",
  "NOT_FOUND",
  "FORBIDDEN",
  "CONFLICT",
  "SYSTEM_PAUSED",
  "CHANNEL_PAUSED",
  "RATE_LIMITED",
  "SPEND_LIMIT_REACHED",
  "AMBIGUOUS_EXTERNAL_STATE",
  "EXTERNAL_UNAVAILABLE",
  "CREDENTIAL_EXPIRED",
  "INTERNAL",
  /** The model provider declined the request (safety refusal). Not retried automatically. */
  "CONTENT_REFUSED",
  /** A rights, voice or file-integrity check blocked the work (fail closed, rule 3/5). */
  "RIGHTS_BLOCKED",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Codes after which a retry may succeed without operator action. */
const RETRYABLE_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "RATE_LIMITED",
  "EXTERNAL_UNAVAILABLE",
]);

export type SafeDetails = Readonly<Record<string, string | number | boolean | null>>;

export interface DomainErrorOptions {
  /** Non-sensitive context only. Never put tokens, signed URLs or prompts here. */
  readonly details?: SafeDetails;
  readonly cause?: unknown;
}

export class DomainError extends Error {
  override readonly name = "DomainError";
  readonly code: ErrorCode;
  readonly details: SafeDetails;

  constructor(code: ErrorCode, message: string, options: DomainErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.details = options.details ?? {};
  }

  /**
   * Whether an automatic retry is allowed. AMBIGUOUS_EXTERNAL_STATE is deliberately not
   * retryable: the external state must be reconciled first to avoid duplicate publications.
   */
  get retryable(): boolean {
    return RETRYABLE_CODES.has(this.code);
  }

  /** Serializable form for logs and audit events. Excludes the stack and the cause. */
  toJSON(): { name: string; code: ErrorCode; message: string; details: SafeDetails } {
    return { name: this.name, code: this.code, message: this.message, details: this.details };
  }
}

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}
