import { describe, expect, it } from "vitest";

import { APP_ROLES, hasAnyRole, isAppRole, isMember } from "../roles";

describe("roles", () => {
  it("recognises only known roles", () => {
    expect(APP_ROLES).toContain("admin");
    expect(isAppRole("publisher")).toBe(true);
    expect(isAppRole("superuser")).toBe(false);
  });

  it("grants access when any required role is held", () => {
    expect(hasAnyRole(["editor", "publisher"], ["publisher"])).toBe(true);
    expect(hasAnyRole(["admin"], ["admin", "publisher"])).toBe(true);
  });

  it("denies access when no required role is held", () => {
    expect(hasAnyRole(["editor"], ["admin"])).toBe(false);
    expect(hasAnyRole([], ["read_only"])).toBe(false);
  });

  it("does not treat admin as implicitly holding other roles", () => {
    expect(hasAnyRole(["admin"], ["rights_reviewer"])).toBe(false);
  });

  it("treats users without roles as non-members", () => {
    expect(isMember([])).toBe(false);
    expect(isMember(["read_only"])).toBe(true);
  });
});
