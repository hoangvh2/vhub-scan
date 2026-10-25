import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runPipeline } from "../src/pipeline.js";
import { createApp } from "../src/server.js";
import { SettingsStore } from "../src/settingsStore.js";
import { rig } from "./helpers.js";
import { cfg, world } from "./world.js";

const TOKEN = "test-token-123";
let base = "";
let close: () => void = () => undefined;
let r: ReturnType<typeof rig>;
let ranNow = 0;
let settings: SettingsStore;

beforeAll(async () => {
  r = rig({ cfg: cfg(), ...world() });
  await runPipeline(r.deps);
  const dir = mkdtempSync(join(tmpdir(), "vhub-server-settings-"));
  settings = new SettingsStore(join(dir, "config.json"), dir, () => r.clock.now());
  const app = createApp({
    db: r.db, store: r.store, budget: r.deps.budget, token: TOKEN, clock: r.clock, settings,
    runNow: async () => (ranNow++ === 0 ? { started: true } : { started: false, reason: "already running" }),
    extraHealth: () => ({ cloud: null, lan: true }),
  });
  await new Promise<void>((ok) => app.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  close = () => app.close();
});
afterAll(() => close());

const get = (p: string, token = TOKEN) => fetch(base + p, { headers: { authorization: `Bearer ${token}` } });
const post = (p: string, body: unknown) => fetch(base + p, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(body) });

describe("local API", () => {
  it("serves the dashboard page without a token but not the API", async () => {
    const page = await fetch(base + "/");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("VHub Trend Scan");
    expect(page.headers.get("x-frame-options")).toBe("DENY");
    expect((await fetch(base + "/api/digest")).status).toBe(401);
    expect((await get("/api/digest", "wrong")).status).toBe(401);
    expect((await fetch(base + `/api/digest?t=${TOKEN}`)).status).toBe(200);
  });
  it("returns today's digest with cards", async () => {
    const d = (await (await get("/api/digest")).json()) as { day: string; items: { id: string; card: { what: string } | null; sources: string[] }[] };
    expect(d.day).toBe("2026-10-24");
    expect(d.items.length).toBeGreaterThan(0);
    expect(d.items[0]!.card?.what).toBeTruthy();
  });
  it("shows an entity with its evidence and numbers over time", async () => {
    const e = (await (await get("/api/entity?id=" + encodeURIComponent("github:acme/taskflow"))).json()) as { sightings: unknown[]; observations: unknown[] };
    expect(e.sightings).toHaveLength(3);
    expect(e.observations.length).toBeGreaterThan(0);
    expect((await get("/api/entity?id=nope")).status).toBe(404);
  });
  it("applies Keep and Undo, and Keep moves the item to the kept list", async () => {
    const id = "github:lifehub/planner";
    expect((await post("/api/feedback", { id, action: "keep" })).status).toBe(200);
    const kept = (await (await get("/api/entities?state=kept")).json()) as { items: { id: string }[] };
    expect(kept.items.map((x) => x.id)).toContain(id);
    expect((await post("/api/feedback", { id, action: "reset" })).status).toBe(200);
    expect(r.store.entity(id)!.user_state).toBe("new");
  });
  it("rejects bad input", async () => {
    expect((await post("/api/feedback", { id: "x", action: "explode" })).status).toBe(400);
    expect((await post("/api/feedback", { id: "missing", action: "keep" })).status).toBe(404);
    expect((await post("/api/feedback", { id: "x".repeat(20_000), action: "keep" })).status).toBe(400);
  });
  it("searches only analysed, non-dropped items", async () => {
    const res = (await (await get("/api/entities?q=planner")).json()) as { items: { id: string }[] };
    expect(res.items.map((x) => x.id)).toEqual(["github:lifehub/planner"]);
    const none = (await (await get("/api/entities?q=video")).json()) as { items: unknown[] };
    expect(none.items).toHaveLength(0); // the video editor was dropped by the scope rules
  });
  it("reports health and starts a run on request, refusing a second one", async () => {
    const h = (await (await get("/api/health")).json()) as { lastRun: { status: string }; tokens: { calls: number; limit: number } };
    expect(h.lastRun.status).toBe("ok");
    expect(h.tokens.calls).toBe(2);
    expect((await post("/api/run", {})).status).toBe(202);
    expect((await post("/api/run", {})).status).toBe(409);
  });
  it("serves the cloud snapshot behind the token", async () => {
    const s = (await (await get("/api/snapshot")).json()) as { schema: number; digest: { series: number[] }[]; health: { counts: Record<string, number> } };
    expect(s.schema).toBe(1);
    expect(s.digest[0]!.series.length).toBeGreaterThan(0);
    expect(s.health.counts).toHaveProperty("kept");
    expect((await fetch(base + "/api/snapshot")).status).toBe(401);
  });
});

describe("settings API", () => {
  type Page = { rev: string; values: Record<string, unknown>; defs: { key: string }[]; history: { id: string; changed: string[] }[]; canTestQuery: boolean; categories: { id: string }[] };
  it("needs the token", async () => {
    expect((await fetch(base + "/api/settings")).status).toBe(401);
  });
  it("shows every setting with its value, and saves a change", async () => {
    const page = (await (await get("/api/settings")).json()) as Page;
    expect(page.defs.length).toBeGreaterThan(30);
    expect(page.values["funnel.digestSize"]).toBe(5);
    expect(page.canTestQuery).toBe(false);
    const res = await post("/api/settings", { patch: { "funnel.digestSize": 6 }, baseRev: page.rev });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { changed: string[]; view: Page };
    expect(body.changed).toEqual(["funnel.digestSize"]);
    expect(body.view.history[0]!.changed).toEqual(["funnel.digestSize"]);
    expect(settings.load().funnel.digestSize).toBe(6);
    // The same old revision again: someone saved in between.
    expect((await post("/api/settings", { patch: { "funnel.cardTop": 2 }, baseRev: page.rev })).status).toBe(409);
  });
  it("rejects invalid values with the reason", async () => {
    const res = await post("/api/settings", { patch: { "funnel.digestSize": 99 } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, errors: [{ key: "funnel.digestSize", problem: "lớn nhất là 30" }] });
  });
  it("previews the token estimate and how many seen items a rule change would drop or bring back", async () => {
    const res = await post("/api/settings/preview", { patch: { "funnel.triageTop": 80, "scope.exclude": ["video", "calendar assistant"] } });
    const p = (await res.json()) as { before: { tokens: number }; after: { tokens: number }; recheck: { dropped: number; revived: number } };
    expect(p.after.tokens).toBeGreaterThan(p.before.tokens);
    expect(p.recheck.dropped).toBeGreaterThan(0);
    expect(settings.load().funnel.triageTop).toBe(40); // a preview saves nothing
  });
  it("restores the settings from before a change", async () => {
    const page = (await (await get("/api/settings")).json()) as Page;
    const res = await post("/api/settings/restore", { id: page.history[0]!.id });
    expect(res.status).toBe(200);
    expect(settings.load().funnel.digestSize).toBe(5);
  });
  it("lists items of one category, and health names the categories", async () => {
    const h = (await (await get("/api/health")).json()) as { categories: { id: string }[] };
    expect(h.categories.map((c) => c.id)).toContain("other");
    const all = (await (await get("/api/entities?limit=200")).json()) as { items: { triage: { cat: string | null } }[] };
    const cat = all.items.find((i) => i.triage.cat)!.triage.cat!;
    const some = (await (await get("/api/entities?limit=200&cat=" + cat)).json()) as { items: { triage: { cat: string | null } }[] };
    expect(some.items.length).toBeGreaterThan(0);
    expect(some.items.every((i) => i.triage.cat === cat)).toBe(true);
  });
  it("has no GitHub test button when the server was not given one", async () => {
    expect((await post("/api/settings/test-query", { query: "topic:cli" })).status).toBe(501);
  });
});
