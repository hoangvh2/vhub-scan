import type { Db } from "../db.js";
import { dayOf } from "../model.js";
import type { LlmUsage } from "./types.js";

/**
 * Measured with `claude -p --json-schema --tools ""` (CLI 2.1.310, haiku): a one-line request still reports ~1.8k input
 * tokens per turn and ~3.7k in total, because structured output takes two turns. So batch items into few calls.
 */
export const CLI_FIXED_OVERHEAD_TOKENS = 3_700;

export const estimateTokens = (chars: number): number => Math.ceil(chars / 3);

/** Daily token allowance kept in the database. When it is spent, LLM stages are skipped and the run still ends. */
export class Budget {
  constructor(
    private readonly db: Db,
    private readonly dailyTokens: number,
  ) {}

  used(now: Date): number {
    const r = this.db.get<{ n: number | null }>("SELECT SUM(in_tokens + out_tokens) AS n FROM token_usage WHERE day = ?", dayOf(now));
    return r?.n ?? 0;
  }

  remaining(now: Date): number {
    return Math.max(0, this.dailyTokens - this.used(now));
  }

  canSpend(estimate: number, now: Date): boolean {
    return this.used(now) + estimate <= this.dailyTokens;
  }

  record(stage: string, u: LlmUsage, now: Date): void {
    this.db.run(
      `INSERT INTO token_usage (day, stage, in_tokens, out_tokens, calls, cost_usd) VALUES (?, ?, ?, ?, 1, ?)
       ON CONFLICT(day, stage) DO UPDATE SET in_tokens = in_tokens + excluded.in_tokens, out_tokens = out_tokens + excluded.out_tokens,
         calls = calls + 1, cost_usd = cost_usd + excluded.cost_usd`,
      dayOf(now),
      stage,
      u.inTokens,
      u.outTokens,
      u.costUsd,
    );
  }

  today(now: Date): { inTokens: number; outTokens: number; calls: number; costUsd: number; limit: number } {
    const r = this.db.get<{ i: number | null; o: number | null; c: number | null; usd: number | null }>(
      "SELECT SUM(in_tokens) AS i, SUM(out_tokens) AS o, SUM(calls) AS c, SUM(cost_usd) AS usd FROM token_usage WHERE day = ?",
      dayOf(now),
    );
    return { inTokens: r?.i ?? 0, outTokens: r?.o ?? 0, calls: r?.c ?? 0, costUsd: r?.usd ?? 0, limit: this.dailyTokens };
  }
}
