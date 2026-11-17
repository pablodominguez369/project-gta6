import { describe, expect, it } from "vitest";

import { FeedDiscoveryProvider, type FetchLike } from "../feed-discovery-provider";

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Example</title>
  <item>
    <title>Nuevo tráiler &amp; fecha</title>
    <link>https://www.example.com/news/trailer/?utm_source=rss</link>
    <pubDate>Mon, 16 Nov 2026 10:00:00 GMT</pubDate>
    <description><![CDATA[<p>Resumen <b>breve</b> de la noticia.</p>]]></description>
  </item>
  <item>
    <title>Noticia antigua</title>
    <link>https://example.com/news/old</link>
    <pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate>
  </item>
  <item><title>Sin enlace</title></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Newsroom</title>
  <entry>
    <title type="html">Comunicado oficial</title>
    <link rel="alternate" href="https://example.org/press/1"/>
    <link rel="self" href="https://example.org/press/1.atom"/>
    <published>2026-11-15T09:00:00Z</published>
    <summary>${"Texto largo ".repeat(60)}</summary>
  </entry>
</feed>`;

function respond(body: string, init: ResponseInit & { url?: string } = {}): FetchLike {
  return () => {
    const response = new Response(body, { status: 200, ...init });
    Object.defineProperty(response, "url", { value: init.url ?? "https://example.com/feed.xml" });
    return Promise.resolve(response);
  };
}

const since = new Date("2026-11-10T00:00:00Z");
const now = () => new Date("2026-11-17T12:00:00Z");

function provider(fetchFn: FetchLike, extra: { feedUrl?: string; maxBytes?: number } = {}) {
  return new FeedDiscoveryProvider({
    feedUrl: extra.feedUrl ?? "https://example.com/feed.xml",
    publisher: "Example",
    termsUrl: "https://example.com/terms",
    fetch: fetchFn,
    now,
    ...(extra.maxBytes === undefined ? {} : { maxBytes: extra.maxBytes }),
  });
}

describe("FeedDiscoveryProvider", () => {
  it("parses RSS, normalizes the item and skips old or incomplete ones", async () => {
    const result = await provider(respond(RSS)).fetchSince(since);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]).toMatchObject({
      canonicalUrl: "https://example.com/news/trailer",
      title: "Nuevo tráiler & fecha",
      publishedAt: "2026-11-16T10:00:00.000Z",
      observedAt: "2026-11-17T12:00:00.000Z",
      excerpt: "Resumen breve de la noticia.",
      publisher: "Example",
    });
    expect(result.value[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("parses Atom, uses the alternate link and caps the excerpt", async () => {
    const result = await provider(respond(ATOM)).fetchSince(since);
    expect(result.ok && result.value[0]?.canonicalUrl).toBe("https://example.org/press/1");
    expect(result.ok && (result.value[0]?.excerpt?.length ?? 0) <= 300).toBe(true);
  });

  it("sends a generic user agent and no personal data", async () => {
    let headers: Headers | undefined;
    const spy: FetchLike = (url, init) => {
      headers = new Headers(init.headers);
      return respond(RSS)(url, init);
    };
    await provider(spy).fetchSince(since);
    expect(headers?.get("user-agent")).toBe("MediaFactoryFeedReader/0.1");
  });

  it("refuses non-HTTPS feeds without fetching", async () => {
    let called = false;
    const spy: FetchLike = (url, init) => {
      called = true;
      return respond(RSS)(url, init);
    };
    const result = await provider(spy, { feedUrl: "http://example.com/feed.xml" }).fetchSince(
      since,
    );
    expect(!result.ok && result.error.code).toBe("VALIDATION_FAILED");
    expect(called).toBe(false);
  });

  it("refuses a redirect to plain HTTP", async () => {
    const result = await provider(respond(RSS, { url: "http://example.com/feed.xml" })).fetchSince(
      since,
    );
    expect(!result.ok && result.error.code).toBe("VALIDATION_FAILED");
  });

  it("refuses documents with a DTD (entity expansion)", async () => {
    const evil = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><rss><channel></channel></rss>`;
    const result = await provider(respond(evil)).fetchSince(since);
    expect(!result.ok && result.error.code).toBe("VALIDATION_FAILED");
  });

  it("stops reading a feed larger than the limit", async () => {
    const result = await provider(respond(RSS), { maxBytes: 100 }).fetchSince(since);
    expect(!result.ok && result.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects HTML or other non-feed documents", async () => {
    const result = await provider(respond("<html><body>hi</body></html>")).fetchSince(since);
    expect(!result.ok && result.error.code).toBe("VALIDATION_FAILED");
  });

  it.each([
    [429, "RATE_LIMITED"],
    [403, "FORBIDDEN"],
    [401, "FORBIDDEN"],
    [503, "EXTERNAL_UNAVAILABLE"],
    [404, "EXTERNAL_UNAVAILABLE"],
  ])("maps HTTP %i to %s", async (status, code) => {
    const result = await provider(respond("", { status })).fetchSince(since);
    expect(!result.ok && result.error.code).toBe(code);
  });

  it("maps network errors and timeouts to EXTERNAL_UNAVAILABLE", async () => {
    const failing: FetchLike = () => Promise.reject(new Error("timeout"));
    const result = await provider(failing).fetchSince(since);
    expect(!result.ok && result.error.code).toBe("EXTERNAL_UNAVAILABLE");
  });
});
