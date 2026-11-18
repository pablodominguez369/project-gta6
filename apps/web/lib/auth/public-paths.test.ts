import { describe, expect, it } from "vitest";

import { isPublicPath } from "./public-paths";

describe("isPublicPath", () => {
  it("allows the login and legal pages", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/legal/terms")).toBe(true);
    expect(isPublicPath("/legal/privacy")).toBe(true);
  });

  it("keeps the panel private", () => {
    expect(isPublicPath("/admin")).toBe(false);
    expect(isPublicPath("/admin/channels")).toBe(false);
    expect(isPublicPath("/legalese")).toBe(false);
    expect(isPublicPath("/")).toBe(false);
  });
});
