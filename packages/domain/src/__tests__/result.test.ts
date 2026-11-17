import { describe, expect, it } from "vitest";

import { err, isErr, isOk, mapResult, ok, unwrap } from "../result";

describe("Result", () => {
  it("narrows Ok and Err", () => {
    const success = ok(42);
    const failure = err("boom");

    expect(isOk(success)).toBe(true);
    expect(isErr(success)).toBe(false);
    expect(isErr(failure)).toBe(true);
  });

  it("maps only Ok values", () => {
    expect(mapResult(ok(2), (n) => n * 3)).toEqual(ok(6));
    expect(mapResult(err<string>("boom"), (n: number) => n * 3)).toEqual(err("boom"));
  });

  it("unwrap returns the value or throws with the error as cause", () => {
    expect(unwrap(ok("value"))).toBe("value");
    expect(() => unwrap(err("boom"))).toThrow(expect.objectContaining({ cause: "boom" }) as Error);
  });
});
