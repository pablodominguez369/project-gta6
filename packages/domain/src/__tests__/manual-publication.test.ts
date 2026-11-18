import { describe, expect, it } from "vitest";

import { isPlatformPermalink, manualUploadSteps } from "../manual-publication";

describe("isPlatformPermalink", () => {
  it.each([
    ["youtube", "https://www.youtube.com/shorts/abc123"],
    ["youtube", "https://youtu.be/abc123"],
    ["instagram", "https://www.instagram.com/reel/abc/"],
    ["tiktok", "https://www.tiktok.com/@cuenta/video/123"],
  ] as const)("accepts a %s link on its own domain", (platform, url) => {
    expect(isPlatformPermalink(platform, url)).toBe(true);
  });

  it.each([
    ["youtube", "http://www.youtube.com/shorts/abc"],
    ["youtube", "https://youtube.com.evil.example/x"],
    ["instagram", "https://www.tiktok.com/@a/video/1"],
    ["tiktok", "javascript:alert(1)"],
    ["tiktok", "https://user:pass@www.tiktok.com/x"],
    ["tiktok", `https://www.tiktok.com/${"a".repeat(600)}`],
  ] as const)("rejects %s %s", (platform, url) => {
    expect(isPlatformPermalink(platform, url)).toBe(false);
  });
});

describe("manualUploadSteps", () => {
  it("asks for the AI disclosure on every real platform when the voice is synthetic", () => {
    for (const platform of ["youtube", "instagram", "tiktok"] as const) {
      expect(manualUploadSteps(platform, true).disclosure).toEqual(expect.any(String));
      expect(manualUploadSteps(platform, false).disclosure).toBeNull();
    }
  });
});
