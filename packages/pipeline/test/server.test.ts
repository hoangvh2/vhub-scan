import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runPipeline } from "../src/pipeline.js";
import { createApp } from "../src/server.js";
import { rig } from "./helpers.js";
import { cfg, world } from "./world.js";

const TOKEN = "test-token-123";
let base = "";
let close: () => void = () => undefined;
let r: ReturnType<typeof rig>;
let ranNow = 0;

beforeAll(async () => {
  r = rig({ cfg: cfg(), ...world() });
  await runPipeline(r.deps);
  const app = createApp({
    db: r.db, store: r.store, budget: r.deps.budget, token: TOKEN, clock: r.clock,
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
