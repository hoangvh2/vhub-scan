import { defaultConfig, type Config } from "../src/config.js";
import { Db } from "../src/db.js";
import { Budget } from "../src/llm/budget.js";
import { FakeLlm } from "../src/llm/fake.js";
import { LlmRunner } from "../src/llm/runner.js";
import type { Clock, RawItem } from "../src/model.js";
import type { Deps } from "../src/pipeline.js";
import { GitHubSource } from "../src/sources/github.js";
import { HackerNewsSource } from "../src/sources/hackernews.js";
import { Store } from "../src/store.js";

export class TestClock implements Clock {
  constructor(public t: Date) {}
  now(): Date {
    return new Date(this.t);
  }
  advanceDays(n: number): void {
    this.t = new Date(this.t.getTime() + n * 86_400_000);
  }
}

export const NOW = new Date("2026-10-24T01:00:00Z");

export function cfgWith(over: Partial<Config> = {}): Config {
  return structuredClone({ ...defaultConfig, ...over, llm: { ...defaultConfig.llm, kind: "fake" as const } });
}

export function gh(name: string, o: Partial<{ desc: string; stars: number; forks: number; topics: string[]; created: string; license: string; fork: boolean }> = {}) {
  const [owner] = name.split("/");
  return {
    full_name: name,
    html_url: `https://github.com/${name}`,
    description: o.desc ?? `A tool that helps you automate your workflow with ${name.split("/")[1]}`,
    stargazers_count: o.stars ?? 12,
    forks_count: o.forks ?? 1,
    topics: o.topics ?? ["productivity"],
    language: "TypeScript",
    license: { spdx_id: o.license ?? "MIT" },
    created_at: o.created ?? "2026-10-15T00:00:00Z",
    fork: o.fork ?? false,
    archived: false,
    owner: { login: owner },
  };
}

type Route = (url: URL) => unknown | { status: number; headers?: Record<string, string> } | undefined;

/** A fetch that serves canned JSON by URL. Unknown URLs fail the test loudly. */
export function fakeFetch(route: Route, log: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    log.push(url.pathname + url.search);
    const r = route(url);
    if (r === undefined) throw new Error(`unexpected request: ${url.href}`);
    if (typeof r === "object" && r !== null && "status" in r) {
      const x = r as { status: number; headers?: Record<string, string> };
      return new Response("{}", { status: x.status, headers: x.headers });
    }
    if (typeof r === "string") return new Response(r, { status: 200 });
    return new Response(JSON.stringify(r), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

export interface Rig {
  deps: Deps;
  db: Db;
  store: Store;
  fake: FakeLlm;
  clock: TestClock;
  cfg: Config;
  runner: LlmRunner;
}

export function rig(opts: { cfg?: Config; fetchImpl?: typeof fetch; hnFetch?: typeof fetch; db?: Db; clock?: TestClock; fake?: FakeLlm } = {}): Rig {
  const cfg = opts.cfg ?? cfgWith();
  const db = opts.db ?? new Db(":memory:");
  const store = new Store(db, cfg);
  const fake = opts.fake ?? new FakeLlm();
  const budget = new Budget(db, cfg.budget.dailyTokens);
  const runner = new LlmRunner(fake, db, budget, async () => undefined);
  const clock = opts.clock ?? new TestClock(NOW);
  const github = opts.fetchImpl ? new GitHubSource({ cfg: cfg.sources.github, fetchImpl: opts.fetchImpl, sleep: async () => undefined }) : undefined;
  const hn = opts.hnFetch
    ? (last: number) => new HackerNewsSource({ cfg: cfg.sources.hn, fetchImpl: opts.hnFetch, sleep: async () => undefined, lastMaxId: last })
    : undefined;
  return { deps: { cfg, db, store, llm: runner, budget, clock, github, hn }, db, store, fake, clock, cfg, runner };
}

export const item = (o: Partial<RawItem> & { sourceId: string }): RawItem => ({
  source: "github",
  url: `https://github.com/${o.sourceId}`,
  title: o.sourceId,
  description: "A tool that helps you plan your week and automate your daily workflow",
  topics: [],
  metrics: { stars: 10 },
  createdAt: "2026-10-15T00:00:00Z",
  ...o,
});
