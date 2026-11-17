import { DomainError } from "./errors";
import { err, ok, type Result } from "./result";

/** Time zone that defines "today" and "this month" for the spend limits. */
export const SPEND_TIMEZONE = "Europe/Madrid";

export interface SpendCheckInput {
  /** From system_controls. 0 means "no spending allowed" (the default). */
  readonly dailyLimitEur: number;
  readonly monthlyLimitEur: number;
  /** Already spent today / this month (Europe/Madrid calendar). */
  readonly spentTodayEur: number;
  readonly spentMonthEur: number;
  /** Worst-case cost of the call about to be made (input + the full output allowance). */
  readonly maxCostEur: number;
}

/**
 * Spend gate (rule 8). A call may run only if, even at its worst-case cost, both the daily and
 * the monthly limit hold. A limit of 0 blocks everything; limits are never raised automatically.
 */
export function checkSpend(input: SpendCheckInput): Result<void, DomainError> {
  const values = Object.values(input);
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    return err(new DomainError("VALIDATION_FAILED", "Spend values must be finite and >= 0"));
  }
  const details = {
    dailyLimitEur: input.dailyLimitEur,
    monthlyLimitEur: input.monthlyLimitEur,
    spentTodayEur: input.spentTodayEur,
    spentMonthEur: input.spentMonthEur,
    maxCostEur: input.maxCostEur,
  };
  if (input.dailyLimitEur === 0 || input.monthlyLimitEur === 0) {
    return err(new DomainError("SPEND_LIMIT_REACHED", "Spend limit is 0", { details }));
  }
  if (input.spentTodayEur + input.maxCostEur > input.dailyLimitEur) {
    return err(new DomainError("SPEND_LIMIT_REACHED", "Daily spend limit reached", { details }));
  }
  if (input.spentMonthEur + input.maxCostEur > input.monthlyLimitEur) {
    return err(new DomainError("SPEND_LIMIT_REACHED", "Monthly spend limit reached", { details }));
  }
  return ok(undefined);
}
