import { createHash } from "node:crypto";

import {
  canonicalizeUrl,
  DomainError,
  err,
  ok,
  toExcerpt,
  toPlainText,
  type Result,
} from "@gta6/domain";
import { XMLParser } from "fast-xml-parser";

import type { DiscoveredItem, DiscoveryProvider } from "./discovery-provider";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface FeedDiscoveryOptions {
  readonly feedUrl: string;
  readonly publisher: string;
  readonly termsUrl: string;
  /** Injected so tests never touch the network. Defaults to the global fetch. */
  readonly fetch?: FetchLike;
  /** Generic identification only; never a person's name or email. */
  readonly userAgent?: string;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly maxItems?: number;
  readonly now?: () => Date;
}

export const DEFAULT_FEED_USER_AGENT = "MediaFactoryFeedReader/0.1";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_ITEMS = 100;

type Node = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true,
  parseTagValue: false,
});

/** Reads one allowlisted RSS 2.0 or Atom feed over HTTPS. */
export class FeedDiscoveryProvider implements DiscoveryProvider {
  readonly name: string;
  readonly termsUrl: string;
  private readonly options: FeedDiscoveryOptions;

  constructor(options: FeedDiscoveryOptions) {
    this.options = options;
    this.name = `feed:${options.feedUrl}`;
    this.termsUrl = options.termsUrl;
  }

  async fetchSince(since: Date): Promise<Result<readonly DiscoveredItem[], DomainError>> {
    const { feedUrl } = this.options;
    if (!feedUrl.startsWith("https://")) {
      return err(new DomainError("VALIDATION_FAILED", "Feeds must use HTTPS"));
    }

    const body = await this.download(feedUrl);
    if (!body.ok) return body;

    // DTDs enable entity-expansion attacks and are never needed in a news feed.
    if (/<!DOCTYPE|<!ENTITY/i.test(body.value)) {
      return err(new DomainError("VALIDATION_FAILED", "Feeds with a DTD are not accepted"));
    }

    let document: unknown;
    try {
      document = parser.parse(body.value);
    } catch {
      return err(new DomainError("VALIDATION_FAILED", "Feed is not well-formed XML"));
    }

    const entries = extractEntries(document);
    if (entries === null) {
      return err(new DomainError("VALIDATION_FAILED", "Not an RSS or Atom feed"));
    }

    const observedAt = (this.options.now?.() ?? new Date()).toISOString();
    const items: DiscoveredItem[] = [];
    for (const entry of entries.slice(0, this.options.maxItems ?? DEFAULT_MAX_ITEMS)) {
      const item = toItem(entry, this.options.publisher, observedAt);
      if (!item) continue;
      if (item.publishedAt !== null && Date.parse(item.publishedAt) <= since.getTime()) continue;
      items.push(item);
    }
    return ok(items);
  }

  private async download(url: string): Promise<Result<string, DomainError>> {
    const fetchFn = this.options.fetch ?? fetch;
    const maxBytes = this.options.maxBytes ?? DEFAULT_MAX_BYTES;
    let response: Response;
    try {
      response = await fetchFn(url, {
        headers: {
          "user-agent": this.options.userAgent ?? DEFAULT_FEED_USER_AGENT,
          accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch {
      return err(new DomainError("EXTERNAL_UNAVAILABLE", "Feed request failed or timed out"));
    }

    if (response.url && !response.url.startsWith("https://")) {
      return err(new DomainError("VALIDATION_FAILED", "Feed redirected away from HTTPS"));
    }
    if (response.status === 429) return err(new DomainError("RATE_LIMITED", "Feed rate limited"));
    if (response.status === 401 || response.status === 403) {
      // Never try to get around an access restriction (rule 3).
      return err(new DomainError("FORBIDDEN", "Feed requires access we do not have"));
    }
    if (!response.ok) {
      return err(
        new DomainError("EXTERNAL_UNAVAILABLE", "Feed returned an error", {
          details: { status: response.status },
        }),
      );
    }

    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > maxBytes) return err(new DomainError("VALIDATION_FAILED", "Feed is too large"));

    const reader = (response.body as ReadableStream<Uint8Array> | null)?.getReader();
    if (!reader) return ok("");
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return err(new DomainError("VALIDATION_FAILED", "Feed is too large"));
      }
      chunks.push(value);
    }
    return ok(Buffer.concat(chunks).toString("utf8"));
  }
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (isNode(value) && typeof value["#text"] === "string") return value["#text"];
  return null;
}

function extractEntries(document: unknown): Node[] | null {
  if (!isNode(document)) return null;
  const rss = document.rss;
  if (isNode(rss) && isNode(rss.channel)) return asArray(rss.channel.item).filter(isNode);
  const feed = document.feed;
  if (isNode(feed)) return asArray(feed.entry).filter(isNode);
  return null;
}

function atomLink(entry: Node): string | null {
  const links = asArray(entry.link).filter(isNode);
  const preferred =
    links.find((link) => link["@_rel"] === undefined || link["@_rel"] === "alternate") ?? links[0];
  const href = preferred?.["@_href"];
  return typeof href === "string" ? href : null;
}

function toIso(value: string | null): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function toItem(entry: Node, publisher: string, observedAt: string): DiscoveredItem | null {
  const rawTitle = textOf(entry.title);
  const link = textOf(entry.link) ?? atomLink(entry);
  if (!rawTitle || !link) return null;

  const canonical = canonicalizeUrl(link);
  if (!canonical.ok) return null;
  const title = toPlainText(rawTitle).slice(0, 500);
  if (title.length === 0) return null;

  const excerpt = toExcerpt(
    textOf(entry.description) ?? textOf(entry.summary) ?? textOf(entry.content),
  );
  const publishedAt = toIso(
    textOf(entry.pubDate) ?? textOf(entry.published) ?? textOf(entry.updated),
  );
  const contentHash = createHash("sha256")
    .update(`${canonical.value}\n${title}\n${excerpt ?? ""}`)
    .digest("hex");

  return {
    url: link,
    canonicalUrl: canonical.value,
    publisher,
    title,
    publishedAt,
    observedAt,
    excerpt,
    contentHash,
  };
}
