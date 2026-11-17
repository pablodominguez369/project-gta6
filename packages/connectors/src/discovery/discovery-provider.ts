import type { DomainError, Result } from "@gta6/domain";

/**
 * Discovery contract. Providers only use permitted sources (official feeds, allowlisted RSS/Atom,
 * licensed APIs); no scraping behind logins, no CAPTCHA evasion, no private endpoints (rule 3).
 */
export interface DiscoveredItem {
  readonly url: string;
  readonly canonicalUrl: string;
  readonly publisher: string;
  readonly title: string;
  /** ISO timestamp from the source, or null when it gives none. */
  readonly publishedAt: string | null;
  readonly observedAt: string;
  /** At most 300 characters of plain text, or null. Never the full article. */
  readonly excerpt: string | null;
  /** SHA-256 (hex) of canonical URL + title + excerpt, to spot changed or repeated items. */
  readonly contentHash: string;
}

export interface DiscoveryProvider {
  readonly name: string;
  /** Terms of use the source was reviewed against before it was enabled. */
  readonly termsUrl: string;
  /** Items published after `since` (items without a date are always returned). */
  fetchSince(since: Date): Promise<Result<readonly DiscoveredItem[], DomainError>>;
}
