/**
 * Redaction for logs and audit details. Applied to every structured log entry and to
 * audit_events.safe_details, so a mistake upstream does not leak secrets downstream.
 */

export const REDACTED = "[REDACTED]";

/** Keys whose values are always removed, whatever they contain. Matched case-insensitively. */
const SENSITIVE_KEY_PATTERN =
  /(pass(word|wd)?|secret|token|authorization|auth_header|cookie|api[-_]?key|apikey|service[-_]?role|credential|private[-_]?key|signature|session[-_]?id|^sig$|^dsn$|^database_url$)/i;

/** Query parameters that make a URL a bearer credential (signed URLs, OAuth callbacks). */
const SENSITIVE_QUERY_PARAMS =
  /^(token|access_token|refresh_token|id_token|code|sig|signature|x-amz-signature|x-amz-credential|x-amz-security-token|apikey|api_key|key)$/i;

const VALUE_PATTERNS: readonly RegExp[] = [
  // JSON Web Tokens (Supabase anon/service keys, OAuth tokens).
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g,
  // Supabase secret API keys.
  /\bsb_secret_[A-Za-z0-9_-]{8,}/g,
  // Authorization header values.
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
];

const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi;

const MAX_DEPTH = 8;

function redactUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  let changed = false;
  if (url.password) {
    url.password = REDACTED;
    changed = true;
  }
  for (const key of [...url.searchParams.keys()]) {
    if (SENSITIVE_QUERY_PARAMS.test(key)) {
      url.searchParams.set(key, REDACTED);
      changed = true;
    }
  }
  // URL serialization percent-encodes the marker; restore it for readability.
  return changed ? url.toString().replaceAll(encodeURIComponent(REDACTED), REDACTED) : raw;
}

export function redactString(value: string): string {
  let result = value.replace(URL_PATTERN, (match) => redactUrl(match));
  for (const pattern of VALUE_PATTERNS) {
    result = result.replace(pattern, REDACTED);
  }
  return result;
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

/** Deep-copies `value`, removing sensitive keys and sensitive substrings. Never mutates input. */
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (depth >= MAX_DEPTH) {
    return "[MaxDepth]";
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1, seen));
  }
  if (value instanceof Error) {
    return {
      type: value.name,
      message: redactString(value.message),
      ...(value.stack === undefined ? {} : { stack: redactString(value.stack) }),
      ...redactObject(value as unknown as Record<string, unknown>, depth, seen),
    };
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return redactObject(value as Record<string, unknown>, depth, seen);
}

function redactObject(
  value: Record<string, unknown>,
  depth: number,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = isSensitiveKey(key) ? REDACTED : redact(item, depth + 1, seen);
  }
  return output;
}
