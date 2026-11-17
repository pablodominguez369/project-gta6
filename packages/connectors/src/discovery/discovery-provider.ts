import type { DomainError, Result } from "@gta6/domain";

/**
 * Contract only (Phase 1). Implementations arrive in Phase 2. Providers only use permitted
 * sources (official feeds, licensed APIs); no scraping behind logins, no CAPTCHA evasion (rule 3).
 */
export interface DiscoveredItem {
  readonly url: string;
  readonly canonicalUrl: string;
  readonly publisher: string;
  readonly title: string;
  readonly publishedAt: string | null;
  readonly observedAt: string;
  /** Short excerpt, only where the source's terms allow storing it. */
  readonly excerpt: string | null;
}

export interface DiscoveryProvider {
  readonly name: string;
  /** Terms of use / robots policy the provider was reviewed against. */
  readonly termsUrl: string;
  fetchSince(since: Date): Promise<Result<readonly DiscoveredItem[], DomainError>>;
}
