import { SPEND_TIMEZONE } from "@gta6/domain";
import type pg from "pg";

export interface SpendSnapshot {
  readonly dailyLimitEur: number;
  readonly monthlyLimitEur: number;
  readonly spentTodayEur: number;
  readonly spentMonthEur: number;
}

export interface LlmUsageRecord {
  readonly provider: string;
  readonly model: string;
  /** The prompt id, e.g. "script.generate". */
  readonly purpose: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costEur: number;
  readonly requestId: string | null;
}

/** Persistence for the spend gate. Postgres today; swappable for tests. */
export interface LlmUsageStore {
  /**
   * Runs `fn` while holding the single spend lock, so two calls can never both pass the gate on
   * the same remaining budget.
   */
  withSpendLock<T>(fn: () => Promise<T>): Promise<T>;
  loadSpend(now: Date): Promise<SpendSnapshot>;
  /** Returns the llm_usage id. Never stores prompts or outputs. */
  record(usage: LlmUsageRecord): Promise<string>;
}

interface SpendRow {
  daily_spend_limit_eur: string;
  monthly_spend_limit_eur: string;
  spent_today: string;
  spent_month: string;
}

/** Worker-only implementation over a direct connection (bypasses RLS, like the secret key). */
export class PgLlmUsageStore implements LlmUsageStore {
  constructor(private readonly pool: pg.Pool) {}

  async withSpendLock<T>(fn: () => Promise<T>): Promise<T> {
    // Session-level lock on its own connection: released explicitly, or by Postgres if the
    // worker dies, so it is never left behind.
    const client = await this.pool.connect();
    const key = "hashtextextended('llm-spend', 0)";
    try {
      await client.query(`select pg_advisory_lock(${key})`);
      try {
        return await fn();
      } finally {
        await client.query(`select pg_advisory_unlock(${key})`);
      }
    } finally {
      client.release();
    }
  }

  async loadSpend(now: Date): Promise<SpendSnapshot> {
    const { rows } = await this.pool.query<SpendRow>(
      `select s.daily_spend_limit_eur, s.monthly_spend_limit_eur,
              coalesce((select sum(u.cost_eur) from public.llm_usage u
                         where u.created_at >= date_trunc('day', $1::timestamptz, $2)), 0) as spent_today,
              coalesce((select sum(u.cost_eur) from public.llm_usage u
                         where u.created_at >= date_trunc('month', $1::timestamptz, $2)), 0) as spent_month
         from public.system_controls s`,
      [now, SPEND_TIMEZONE],
    );
    const row = rows[0];
    // No controls row means nothing is configured: treat it as a 0 limit (blocked).
    if (!row) return { dailyLimitEur: 0, monthlyLimitEur: 0, spentTodayEur: 0, spentMonthEur: 0 };
    return {
      dailyLimitEur: Number(row.daily_spend_limit_eur),
      monthlyLimitEur: Number(row.monthly_spend_limit_eur),
      spentTodayEur: Number(row.spent_today),
      spentMonthEur: Number(row.spent_month),
    };
  }

  async record(usage: LlmUsageRecord): Promise<string> {
    const { rows } = await this.pool.query<{ id: string }>(
      `insert into public.llm_usage
         (provider, model, purpose, input_tokens, output_tokens, cost_eur, request_id)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id`,
      [
        usage.provider,
        usage.model,
        usage.purpose,
        usage.inputTokens,
        usage.outputTokens,
        // Rounded up to the column's 4 decimals so recorded spend never under-counts.
        Math.ceil(usage.costEur * 10_000) / 10_000,
        usage.requestId,
      ],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error("llm_usage insert returned no id");
    return id;
  }
}
