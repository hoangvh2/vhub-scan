import { describe, expect, it } from "vitest";
import { cleanReadme } from "../src/text.js";
import { defaultConfig } from "../src/config.js";
import { expandQuery, GitHubSource } from "../src/sources/github.js";
import { HackerNewsSource, mapHn } from "../src/sources/hackernews.js";
import { httpGet, RateLimited } from "../src/sources/http.js";
import { fakeFetch, gh, NOW } from "./helpers.js";

const noSleep = async () => undefined;

describe("GitHubSource", () => {
  it("expands date placeholders", () => {
    expect(expandQuery("topic:x created:>{d14}", NOW)).toBe("topic:x created:>2026-10-10");
  });
  it("searches, skips forks, maps fields, and visits seed authors", async () => {
    const seen: string[] = [];
    const f = fakeFetch((u) => {
      if (u.pathname === "/search/repositories") return { items: [gh("acme/taskflow", { license: "NOASSERTION" }), gh("x/forked", { fork: true })] };
      if (u.pathname === "/users/alice/repos") return [gh("alice/helper")];
      if (u.pathname === "/users/ghost/repos") return { status: 404 };
    }, seen);
    const cfg = { ...defaultConfig.sources.github, queries: ["topic:claude-code created:>{d14}"], seeds: ["alice", "ghost"] };
    const items = await new GitHubSource({ cfg, fetchImpl: f, sleep: noSleep, token: "t" }).collect(NOW);
    expect(items.map((i) => i.sourceId)).toEqual(["acme/taskflow", "alice/helper"]);
    expect(items[0]).toMatchObject({ title: "acme/taskflow", author: "acme", metrics: { stars: 12, forks: 1 }, license: undefined });
    expect(items[1]!.fromSeed).toBe(true);
    expect(seen[0]).toContain("q=topic%3Aclaude-code%20created%3A%3E2026-10-10");
  });
  it("turns an exhausted rate limit into RateLimited", async () => {
    const f = fakeFetch(() => ({ status: 403, headers: { "x-ratelimit-remaining": "0" } }));
    await expect(new GitHubSource({ cfg: { ...defaultConfig.sources.github, queries: ["q"] }, fetchImpl: f, sleep: noSleep }).collect(NOW)).rejects.toBeInstanceOf(RateLimited);
  });
  it("fetches a README as a compact excerpt", async () => {
    const md = "# Taskflow\n[![CI](https://x/badge.svg)](https://x)\n\nPlan your **week** from the terminal. See [docs](https://d.example).\n```sh\nnpm i taskflow\n```\n";
    const f = fakeFetch((u) => (u.pathname === "/repos/acme/taskflow/readme" ? md : undefined));
    const t = await new GitHubSource({ cfg: defaultConfig.sources.github, fetchImpl: f, sleep: noSleep }).readme("acme/taskflow", 200);
    expect(t).toBe("Taskflow Plan your week from the terminal. See docs.");
  });
});

describe("cleanReadme", () => {
  it("respects the length cap on a word boundary", () => {
    expect(cleanReadme("word ".repeat(100), 22).length).toBeLessThanOrEqual(22);
  });
});

describe("HackerNewsSource", () => {
  it("maps Show HN stories and only fetches ids above the cursor", async () => {
    const seen: string[] = [];
    const f = fakeFetch((u) => {
      if (u.pathname.endsWith("showstories.json")) return [105, 104, 103];
      const id = Number(/item\/(\d+)/.exec(u.pathname)?.[1]);
      if (id === 105) return { id, type: "story", title: "Show HN: Habito – a habit tracker for busy people", url: "https://habito.example.com", by: "bob", time: 1792800000, score: 42, descendants: 7 };
      if (id === 104) return { id, type: "story", title: "Show HN: Gone", dead: true };
      if (id === 103) return { id, type: "story", title: "Show HN: Old", url: "https://old.example.com" };
    }, seen);
    const hn = new HackerNewsSource({ cfg: defaultConfig.sources.hn, fetchImpl: f, sleep: noSleep, lastMaxId: 103 });
    const { items, maxId } = await hn.collect();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ source: "hn", sourceId: "105", title: "Habito", description: "a habit tracker for busy people", metrics: { points: 42, comments: 7 } });
    expect(maxId).toBe(105);
    expect(seen.some((s) => s.includes("item/103"))).toBe(false);
  });
  it("uses the title as description when nothing else is given", () => {
    expect(mapHn({ id: 1, type: "story", title: "Show HN: Foo bar baz qux" })!.description).toBe("Foo bar baz qux");
    expect(mapHn({ id: 2, type: "comment", title: "x" })).toBeNull();
  });
});

describe("httpGet", () => {
  it("retries 5xx and then succeeds", async () => {
    let n = 0;
    const f = (async () => (++n < 3 ? new Response("{}", { status: 503 }) : new Response('{"ok":true}'))) as typeof fetch;
    expect(await httpGet("https://x.test/a", { source: "t", fetchImpl: f, sleep: noSleep })).toEqual({ ok: true });
    expect(n).toBe(3);
  });
  it("fails with a short message on a hard error", async () => {
    const f = (async () => new Response("{}", { status: 401 })) as typeof fetch;
    await expect(httpGet("https://x.test/secret?token=abc", { source: "t", fetchImpl: f, sleep: noSleep })).rejects.toThrow("t: HTTP 401 for /secret");
  });
});
