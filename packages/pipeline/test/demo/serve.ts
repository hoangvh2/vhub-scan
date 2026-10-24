// npx vite-node packages/pipeline/test/demo/serve.ts -- [port]
// Dashboard with sample data on http://127.0.0.1:<port>/?t=demo-token (for screenshots and manual checks).
import { Db } from "../../src/db.js";
import { Budget } from "../../src/llm/budget.js";
import { createApp } from "../../src/server.js";
import { Store } from "../../src/store.js";
import { cfgWith } from "../helpers.js";
import { seedDemo } from "./seed.js";

const port = Number(process.argv.at(-1)) || 4199;
const db = new Db(":memory:");
const now = new Date();
seedDemo(db, now);
const cfg = cfgWith();
const store = new Store(db, cfg);
const budget = new Budget(db, cfg.budget.dailyTokens);
const code = JSON.stringify({ v: 1, lan: [`http://192.168.1.20:${port}`], t: "demo-token", fb: { p: "vhub-trend-demo", k: "AIzaDemo", u: "owner", ct: "x".repeat(820) } });
const { qrSvg } = await import("../../src/cloud/pair.js");
createApp({
  db, store, budget, token: "demo-token",
  runNow: async () => ({ started: false, reason: "already running" }),
  pair: () => ({ code, svg: qrSvg(code), lan: [`http://192.168.1.20:${port}`], cloud: true, lanReachable: true, expiresAt: new Date(Date.now() + 3_600_000).toISOString() }),
  extraHealth: () => ({ cloud: { projectId: "vhub-trend-demo", syncMinutes: 10, last: { at: new Date(Date.now() - 4 * 60_000).toISOString(), ok: true, applied: 2, rejected: 0, pushed: true, bytes: 48_000 } }, lan: true }),
}).listen(port, "127.0.0.1", () => console.log(`demo dashboard: http://127.0.0.1:${port}/?t=demo-token`));
