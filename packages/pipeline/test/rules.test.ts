import { describe, expect, it } from "vitest";
import { applyRules, hasTerm } from "../src/rules.js";
import { heuristic, velocity } from "../src/score.js";
import { cfgWith, item, NOW, rig } from "./helpers.js";

const mk = (over: Parameters<typeof item>[0]) => {
  const r = rig();
  const { id } = r.store.upsertItem(item(over), NOW);
  return { r, e: r.store.entity(id)!, id };
};
const ctx = (r: ReturnType<typeof rig>, velocity = 0) => ({ cfg: r.cfg, now: NOW, velocity, isHn: false });

describe("hard rules", () => {
  it("matches whole words only", () => {
    expect(hasTerm("a democracy tool", "ocr")).toBe(false);
    expect(hasTerm("fast ocr engine", "ocr")).toBe(true);
    expect(hasTerm("3d printing planner", "3d")).toBe(true);
    expect(hasTerm("tool for 3dfx fans", "3d")).toBe(false);
  });
  it("drops out-of-scope topics with the matching word as the reason", () => {
    const { r, e } = mk({ sourceId: "a/vid", description: "A simple video editor with timeline and effects for creators" });
    expect(applyRules(e, ctx(r))).toBe("out_of_scope:video");
  });
  it("drops thin descriptions but not those from watched authors", () => {
    const { r, e } = mk({ sourceId: "a/x", description: "todo app" });
    expect(applyRules(e, ctx(r))).toBe("thin");
    const s = mk({ sourceId: "a/y", description: "todo app", fromSeed: true });
    expect(applyRules(s.e, ctx(s.r))).toBeNull();
  });
  it("drops old items unless they are gaining quickly", () => {
    const { r, e } = mk({ sourceId: "a/old", createdAt: "2025-01-01T00:00:00Z" });
    expect(applyRules(e, ctx(r, 0))).toBe("old");
    expect(applyRules(e, ctx(r, 5))).toBeNull();
  });
  it("honours blocked authors and the user's earlier Skip", () => {
    const cfg = cfgWith();
    cfg.scope.blockAuthors = ["Spammer"];
    const r = rig({ cfg });
    const { id } = r.store.upsertItem(item({ sourceId: "spammer/x", author: "spammer" }), NOW);
    expect(applyRules(r.store.entity(id)!, ctx(r))).toBe("blocked_author");
    const q = mk({ sourceId: "a/z" });
    q.r.store.applyFeedback(q.id, "skip", NOW);
    expect(applyRules(q.r.store.entity(q.id)!, ctx(q.r))).toBe("skipped_by_user");
  });
});

describe("heuristic score", () => {
  it("computes velocity from the last two observations, or popularity over age with one", () => {
    expect(velocity([{ day: "2026-10-20", stars: 10, points: null }, { day: "2026-10-24", stars: 50, points: null }], null, NOW)).toBe(10);
    expect(velocity([{ day: "2026-10-24", stars: 30, points: null }], "2026-10-14T00:00:00Z", NOW)).toBeCloseTo(3, 0);
  });
  it("ranks a fast-growing in-scope tool above a flat one, and learns from feedback", () => {
    const r = rig();
    const fast = r.store.upsertItem(item({ sourceId: "a/fast", topics: ["productivity"] }), new Date("2026-10-20T00:00:00Z"));
    r.store.observe(fast.id, { stars: 10 }, new Date("2026-10-20T00:00:00Z"));
    r.store.observe(fast.id, { stars: 90 }, NOW);
    const flat = r.store.upsertItem(item({ sourceId: "a/flat", description: "Another simple helper for plain daily chores around the house" }), NOW);
    const score = (id: string, bias = new Map<string, number>()) =>
      heuristic({ e: r.store.entity(id)!, obs: r.store.observations(id), sources: 1, bias, cfg: r.cfg, now: NOW });
    expect(score(fast.id)).toBeGreaterThan(score(flat.id));
    const liked = new Map([["productivity", 2]]);
    expect(score(fast.id, liked)).toBeGreaterThan(score(fast.id));
  });
});
