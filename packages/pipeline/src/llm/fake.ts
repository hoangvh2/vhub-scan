import { LlmError, type LlmAdapter, type LlmRequest, type LlmResponse } from "./types.js";

/** Deterministic stand-in for tests and dry runs. Scores by keywords found in each line. */
export class FakeLlm implements LlmAdapter {
  readonly name = "fake";
  calls: LlmRequest[] = [];
  failNext = 0;

  async call(req: LlmRequest): Promise<LlmResponse> {
    this.calls.push(req);
    if (this.failNext > 0) {
      this.failNext--;
      throw new LlmError("fake transient error", true);
    }
    let data: unknown;
    if (req.stage === "triage") {
      const lines = req.user.split("\n").filter((l) => l.includes("|"));
      // The first category the schema allows (the first enabled topic) stands for "fits a topic".
      const cats = (req.schema as { properties?: { items?: { items?: { properties?: { c?: { enum?: string[] } } } } } }).properties?.items?.items?.properties?.c?.enum ?? ["other"];
      data = {
        items: lines.map((l) => {
          const id = l.split("|")[0]!;
          const good = /tool|assistant|planner|automation|workflow|agent/i.test(l);
          return { id, s: good ? 3 : 1, c: good ? cats[0] : "other", w: good ? "huu ich cho cong viec" : "it lien quan" };
        }),
      };
    } else {
      const heads = req.user.split("\n").filter((l) => l.startsWith("#"));
      data = {
        items: heads.map((l) => ({
          id: l.slice(1).split("|")[0]!,
          what: "Cong cu giup lam viec.",
          learn: "Cach dong goi quy trinh.",
          apply: [{ project: "VH Flow", how: "Thu mot quy trinh tuong tu." }],
          effort: "S",
          risk: "Kiem tra giay phep.",
        })),
      };
    }
    const n = req.user.split("\n").length;
    return { data, usage: { inTokens: 3700 + Math.ceil(req.user.length / 3), outTokens: 60 + n * 20, costUsd: 0 } };
  }
}
