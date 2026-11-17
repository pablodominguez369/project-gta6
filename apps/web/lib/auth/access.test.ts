import { describe, expect, it } from "vitest";

import { decideAccess } from "./access";

describe("decideAccess", () => {
  it("sends anonymous users to login", () => {
    expect(decideAccess(null, ["admin"])).toBe("unauthenticated");
    expect(decideAccess(null, "member")).toBe("unauthenticated");
  });

  it("forbids an editor from admin-only pages", () => {
    expect(decideAccess({ roles: ["editor"] }, ["admin"])).toBe("forbidden");
  });

  it("allows an admin on admin-only pages", () => {
    expect(decideAccess({ roles: ["admin"] }, ["admin"])).toBe("allow");
  });

  it("forbids signed-in users without any role from member pages", () => {
    expect(decideAccess({ roles: [] }, "member")).toBe("forbidden");
    expect(decideAccess({ roles: ["read_only"] }, "member")).toBe("allow");
  });
});
