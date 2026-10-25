import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadCloudConfig, type CloudConfig } from "./cloud/config.js";
import { FirestoreRest } from "./cloud/firestore.js";
import { ServiceAccountAuth } from "./cloud/google.js";
import { applyRemoteSettings, syncOnce, type SyncResult } from "./cloud/sync.js";
import { githubSettings, loadConfig, type Config } from "./config.js";
import { Db } from "./db.js";
import { ClaudeCliAdapter } from "./llm/claudeCli.js";
import { Budget } from "./llm/budget.js";
import { FakeLlm } from "./llm/fake.js";
import { LlmRunner } from "./llm/runner.js";
import type { LlmAdapter } from "./llm/types.js";
import { systemClock } from "./model.js";
import type { Deps } from "./pipeline.js";
import { GitHubSource } from "./sources/github.js";
import { HackerNewsSource } from "./sources/hackernews.js";
import { SettingsStore } from "./settingsStore.js";
import { Store } from "./store.js";

export interface Home {
  dir: string;
  configFile: string;
  dbFile: string;
  tokenFile: string;
  cloudFile: string;
}

export function resolveHome(arg?: string): Home {
  const dir = arg ?? process.env.VHUB_TREND_HOME ?? join(homedir(), ".vhub-trend");
  return { dir, configFile: join(dir, "config.json"), dbFile: join(dir, "trend.sqlite"), tokenFile: join(dir, "token"), cloudFile: join(dir, "cloud.json") };
}

export function ensureToken(h: Home): string {
  mkdirSync(h.dir, { recursive: true });
  if (existsSync(h.tokenFile)) return readFileSync(h.tokenFile, "utf8").trim();
  const t = randomBytes(24).toString("base64url");
  writeFileSync(h.tokenFile, t + "\n", { mode: 0o600 });
  try {
    chmodSync(h.tokenFile, 0o600);
  } catch {
    /* not supported on this filesystem */
  }
  return t;
}

export const settingsStore = (h: Home): SettingsStore => new SettingsStore(h.configFile, h.dir);

export function loadHomeConfig(h: Home): Config {
  return loadConfig(existsSync(h.configFile) ? h.configFile : null);
}

export function makeAdapter(cfg: Config): LlmAdapter {
  if (cfg.llm.kind === "fake") return new FakeLlm();
  return new ClaudeCliAdapter({ command: cfg.llm.command, timeoutMs: cfg.llm.timeoutMs });
}

/** Wires a pipeline together from a home directory. Secrets come from the environment, never from files in the repo. */
export function buildDeps(h: Home, cfg: Config, opts: { adapter?: LlmAdapter; log?: (m: string) => void; db?: Db } = {}): { deps: Deps; db: Db; store: Store; budget: Budget } {
  const db = opts.db ?? new Db(h.dbFile);
  const store = new Store(db, cfg);
  const budget = new Budget(db, cfg.budget.dailyTokens);
  const llm = new LlmRunner(opts.adapter ?? makeAdapter(cfg), db, budget);
  const token = process.env.GITHUB_TOKEN || undefined;
  const github = new GitHubSource({ cfg: githubSettings(cfg), token });
  const hn = (last: number) => new HackerNewsSource({ cfg: cfg.sources.hn, lastMaxId: last });
  return { deps: { cfg, db, store, llm, budget, clock: systemClock, github, hn, log: opts.log }, db, store, budget };
}

export interface Cloud {
  cfg: CloudConfig;
  docs: FirestoreRest;
  sync: () => Promise<SyncResult>;
  /** Applies settings changes waiting in the cloud (sent from the phone) before a run, so the run uses them. */
  pullSettings: () => Promise<number>;
}

/** Cloud sync when ~/.vhub-trend/cloud.json exists (`npm run cloud:connect`), otherwise null: the app stays PC-only. */
export function buildCloud(h: Home, d: { db: Db; store: Store; budget: Budget; log?: (m: string) => void }): Cloud | null {
  const cfg = loadCloudConfig(h.cloudFile);
  if (!cfg) return null;
  const auth = new ServiceAccountAuth(cfg);
  const docs = new FirestoreRest({ projectId: cfg.projectId, token: () => auth.token(), baseUrl: cfg.firestoreUrl });
  const settings = settingsStore(h);
  return {
    cfg,
    docs,
    sync: () => syncOnce({ ...d, docs, uid: cfg.uid, clock: systemClock, settings }),
    pullSettings: () => applyRemoteSettings({ db: d.db, docs, uid: cfg.uid, clock: systemClock, log: d.log }, settings),
  };
}
