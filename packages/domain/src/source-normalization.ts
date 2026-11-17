import { MAX_EXCERPT_LENGTH } from "./editorial";
import { DomainError } from "./errors";
import { err, ok, type Result } from "./result";

/** Query parameters that only track the reader; they never change which article a URL points to. */
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "ref",
  "ref_src",
  "spm",
]);

/**
 * Canonical form used to de-duplicate sources: http(s) only, lower-case host without "www.",
 * no fragment, no tracking parameters, remaining parameters sorted, no trailing slash.
 */
export function canonicalizeUrl(raw: string): Result<string, DomainError> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return err(new DomainError("VALIDATION_FAILED", "Invalid URL"));
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return err(new DomainError("VALIDATION_FAILED", "Only http(s) URLs are allowed"));
  }
  if (url.username || url.password) {
    return err(new DomainError("VALIDATION_FAILED", "URLs with credentials are not allowed"));
  }

  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if (
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80")
  ) {
    url.port = "";
  }
  const kept = [...url.searchParams.entries()]
    .filter(
      ([key]) => !key.toLowerCase().startsWith("utm_") && !TRACKING_PARAMS.has(key.toLowerCase()),
    )
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  url.search = new URLSearchParams(kept).toString();
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  return ok(url.toString());
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Plain text from a feed field that may contain HTML. Not a sanitizer: output is never rendered as HTML. */
export function toPlainText(value: string): string {
  return value
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (entity, code: string) => {
      if (code.startsWith("#x") || code.startsWith("#X")) {
        return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
      }
      if (code.startsWith("#")) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
      return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** Short excerpt for context and attribution: at most MAX_EXCERPT_LENGTH characters, cut at a word. */
export function toExcerpt(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = toPlainText(value);
  if (text.length === 0) return null;
  if (text.length <= MAX_EXCERPT_LENGTH) return text;
  const cut = text.slice(0, MAX_EXCERPT_LENGTH - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > MAX_EXCERPT_LENGTH / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
