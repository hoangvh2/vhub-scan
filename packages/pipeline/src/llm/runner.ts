import type { Db } from "../db.js";
import { sha256 } from "../text.js";
import { Budget, CLI_FIXED_OVERHEAD_TOKENS, estimateTokens } from "./budget.js";
import { LlmError, type LlmAdapter, type LlmRequest } from "./types.js";

export type CallOutcome =
  | { kind: "ok"; data: unknown; cached: boolean }
  | { kind: "skipped"; reason: "budget" | "error"; detail?: string };

/**
 * Every LLM call goes through here: answer cache first (same content and prompt version means no call),
 * then the daily budget check, then up to two retries on transient errors.
 */
export class LlmRunner {
  calls = 0;
  cacheHits = 0;

  constructor(
    private readonly adapter: LlmAdapter,
    private readonly db: Db,
    private readonly budget: Budget,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  cacheKey(req: LlmRequest): string {
    return sha256([this.adapter.name, req.model, req.promptVersion, req.system, req.user, JSON.stringify(req.schema)].join("\u0001"));
  }

  async call(req: LlmRequest, now: Date): Promise<CallOutcome> {
    const key = this.cacheKey(req);
    const hit = this.db.get<{ output: string }>("SELECT output FROM llm_cache WHERE key = ?", key);
    if (hit) {
      this.cacheHits++;
      return { kind: "ok", data: JSON.parse(hit.output), cached: true };
    }
    const estimate = CLI_FIXED_OVERHEAD_TOKENS + estimateTokens(req.system.length + req.user.length) + req.expectedOutTokens;
    if (!this.budget.canSpend(estimate, now)) return { kind: "skipped", reason: "budget" };

    let lastErr = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await this.sleep(1_000 * 2 ** attempt);
      try {
        this.calls++;
        const res = await this.adapter.call(req);
        this.budget.record(req.stage, res.usage, now);
        this.db.run(
          "INSERT OR REPLACE INTO llm_cache (key, output, in_tokens, out_tokens, created_at) VALUES (?, ?, ?, ?, ?)",
          key,
          JSON.stringify(res.data),
          res.usage.inTokens,
          res.usage.outTokens,
          now.toISOString(),
        );
        return { kind: "ok", data: res.data, cached: false };
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
        if (!(e instanceof LlmError) || !e.retryable) break;
      }
    }
    return { kind: "skipped", reason: "error", detail: lastErr };
  }
}
