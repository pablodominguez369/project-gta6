import { describe, expect, it } from "vitest";

import { checkSpend, type SpendCheckInput } from "../spend";

const base: SpendCheckInput = {
  dailyLimitEur: 5,
  monthlyLimitEur: 50,
  spentTodayEur: 1,
  spentMonthEur: 10,
  maxCostEur: 0.5,
};

describe("checkSpend", () => {
  it("allows a call that fits both limits", () => {
    expect(checkSpend(base).ok).toBe(true);
  });

  it("blocks everything while a limit is 0 (the default)", () => {
    for (const input of [
      { ...base, dailyLimitEur: 0 },
      { ...base, monthlyLimitEur: 0 },
      { ...base, dailyLimitEur: 0, maxCostEur: 0 },
    ]) {
      const result = checkSpend(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("SPEND_LIMIT_REACHED");
    }
  });

  it("blocks when the worst case would pass the daily limit", () => {
    const result = checkSpend({ ...base, spentTodayEur: 4.6 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/Daily/);
  });

  it("allows reaching the limit exactly", () => {
    expect(checkSpend({ ...base, spentTodayEur: 4.5 }).ok).toBe(true);
  });

  it("blocks when the worst case would pass the monthly limit", () => {
    const result = checkSpend({ ...base, spentMonthEur: 49.8 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/Monthly/);
  });

  it("rejects negative or non-finite values", () => {
    expect(checkSpend({ ...base, maxCostEur: -1 }).ok).toBe(false);
    expect(checkSpend({ ...base, spentTodayEur: Number.NaN }).ok).toBe(false);
  });
});
