import { describe, expect, it } from "vitest";

import { MAX_EXCERPT_LENGTH } from "../editorial";
import { canonicalizeUrl, toExcerpt, toPlainText } from "../source-normalization";

const canonical = (raw: string) => {
  const result = canonicalizeUrl(raw);
  return result.ok ? result.value : result.error.code;
};

describe("canonicalizeUrl", () => {
  it("removes tracking parameters, fragments, www and trailing slashes", () => {
    expect(
      canonical("https://WWW.Example.com/news/gta-6/?utm_source=x&b=2&fbclid=abc&a=1#comments"),
    ).toBe("https://example.com/news/gta-6?a=1&b=2");
  });

  it("maps the same article with different tracking to one URL", () => {
    expect(canonical("https://example.com/a?utm_medium=social")).toBe(
      canonical("https://www.example.com/a/"),
    );
  });

  it("keeps meaningful parameters and the path", () => {
    expect(canonical("https://example.com/watch?v=123")).toBe("https://example.com/watch?v=123");
  });

  it.each([
    "ftp://example.com/x",
    "javascript:alert(1)",
    "not a url",
    "https://user:pw@example.com/",
  ])("rejects %s", (raw) => {
    expect(canonical(raw)).toBe("VALIDATION_FAILED");
  });
});

describe("toPlainText and toExcerpt", () => {
  it("strips tags, scripts and entities", () => {
    expect(
      toPlainText("<p>Rockstar &amp; <b>Take-Two</b></p><script>x()</script> &#233;&#x41;"),
    ).toBe("Rockstar & Take-Two éA");
  });

  it("returns null for empty input", () => {
    expect(toExcerpt("")).toBeNull();
    expect(toExcerpt("<p> </p>")).toBeNull();
    expect(toExcerpt(null)).toBeNull();
  });

  it(`never exceeds ${String(MAX_EXCERPT_LENGTH)} characters and cuts at a word`, () => {
    const excerpt = toExcerpt("palabra ".repeat(100)) ?? "";
    expect(excerpt.length).toBeLessThanOrEqual(MAX_EXCERPT_LENGTH);
    expect(excerpt.endsWith("palabra…")).toBe(true);
  });
});
