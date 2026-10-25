// npx vite-node packages/pipeline/test/demo/serve.ts -- [port]
// Dashboard with sample data on http://127.0.0.1:<port>/?t=demo-token (for screenshots and manual checks).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../../src/config.js";
import { Db } from "../../src/db.js";
import { Budget } from "../../src/llm/budget.js";
import { createApp } from "../../src/server.js";
import { SettingsStore } from "../../src/settingsStore.js";
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
// A settings file with two earlier changes, so the settings page shows a history and a custom topic.
const home = mkdtempSync(join(tmpdir(), "vhub-demo-"));
let t = now.getTime() - 3 * 86_400_000;
const settings = new SettingsStore(join(home, "config.json"), home, () => new Date((t += 3_600_000)));
settings.save({ projects: [{ name: "VH Flow", summary: "App quản lý việc hằng ngày cho team nhỏ" }, { name: "VH Studio", summary: "Bộ công cụ dựng nội dung cho người làm một mình" }] }, { source: "pc", origin: "local" });
settings.save(
  { topics: [...defaultConfig.topics, { id: "finance", label: "Tài chính cá nhân", enabled: true, queries: ["topic:personal-finance created:>{d14} stars:>=5"], keywords: ["budget", "expense", "finance"] }], "funnel.digestSize": 6 },
  { source: "phone", origin: "remote", device: "Pixel 8" },
);
createApp({
  db, store, budget, token: "demo-token", settings,
  testQuery: async (q) => ({ total: q.length * 37, items: [{ name: "demo/example-one", stars: 1240, description: "" }, { name: "demo/example-two", stars: 310, description: "" }] }),
  runNow: async () => ({ started: false, reason: "already running" }),
  extraHealth: () => ({ cloud: { projectId: "vhub-trend-demo", syncMinutes: 10, last: { at: new Date(Date.now() - 4 * 60_000).toISOString(), ok: true, applied: 2, rejected: 0, pushed: true, bytes: 48_000 } }, lan: true }),
}).listen(port, "127.0.0.1", () => console.log(`demo dashboard: http://127.0.0.1:${port}/?t=demo-token`));
