import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolveHome } from "../src/app.js";
import { defaultConfig, parseConfig } from "../src/config.js";
import type { RunStats } from "../src/pipeline.js";
import { TODO_MARK, checkConfig, checkGithubToken, initGuide, runSummary } from "../src/setup.js";

const example = () => parseConfig(readFileSync(new URL("../config.example.json", import.meta.url), "utf8"));

describe("setup guidance", () => {
  it("the fresh example config is flagged until every TODO in projects is replaced", () => {
    const fails = checkConfig(example()).filter((i) => i.level === "fail");
    expect(fails.map((i) => i.field)).toEqual(["projects[0].summary (VH Flow)", "projects[1].summary (VH Studio)"]);
    expect(fails[0]!.fix).toMatch(/1–2 câu/);
  });

  it("a filled-in config has nothing left to fix", () => {
    const c = example();
    c.projects = [{ name: "VH Flow", summary: "App quản lý việc hằng ngày cho team nhỏ" }];
    expect(checkConfig(c)).toEqual([]);
  });

  it("no projects is a warning, not a blocker", () => {
    const issues = checkConfig(defaultConfig);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ level: "warn", field: "projects" });
  });

  it("the init guide names the exact file, the fields to change and the next command", () => {
    const home = resolveHome("/home/me/.vhub-trend");
    const g = initGuide(home, true, { os: "linux", githubToken: false });
    expect(g).toContain(`nano "${home.configFile}"`);
    expect(g).toContain(TODO_MARK);
    expect(g).toContain('"summary"');
    expect(g).toContain("https://github.com/settings/personal-access-tokens/new");
    expect(g).toContain("npm run doctor");
    const win = initGuide(resolveHome("C:\\Users\\me\\.vhub-trend"), false, { os: "win32", githubToken: true });
    expect(win).toContain("notepad");
    expect(win).toContain("setx GITHUB_TOKEN");
    expect(win).toContain("không ghi đè");
    expect(win).toContain("ĐÃ có");
  });
});

const reply = (status: number, body: unknown = {}) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("doctor: GitHub token", () => {
  const quota = { resources: { core: { limit: 5000, remaining: 4999 } } };
  it("accepts a working token and shows the quota", async () => {
    expect(await checkGithubToken("t", reply(200, quota))).toEqual({ level: "ok", msg: "GITHUB_TOKEN hợp lệ (còn 4999/5000 request trong giờ này)" });
  });
  it("a rejected token is an error with a fix, not a silent ok", async () => {
    const c = await checkGithubToken("bad", reply(401));
    expect(c.level).toBe("fail");
    expect(c.fix).toMatch(/BƯỚC 2/);
  });
  it("no token is a warning; no network is a warning that says so", async () => {
    expect((await checkGithubToken(undefined, reply(200, quota))).level).toBe("warn");
    const off = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    expect(await checkGithubToken("t", off)).toMatchObject({ level: "warn", msg: expect.stringMatching(/không kết nối/) });
  });
});

describe("scan summary", () => {
  const base: RunStats = { runId: "r", collected: 12, created: 10, merged: 2, dropped: { scope: 3, thin: 1 }, scored: 8, triaged: 8, carded: 3, digest: 3, llmCalls: 2, cacheHits: 0, tokensToday: 7000, degraded: [], sourceErrors: [] };
  it("says what happened and where to look next", () => {
    const s = runSummary(base);
    expect(s).toContain("Thu thập 12 mục (mới 10, gộp trùng 2), loại bởi luật 4");
    expect(s).toContain("npm run dashboard");
  });
  it("turns each source error into a concrete fix", () => {
    const s = runSummary({ ...base, digest: 0, sourceErrors: ["github: github: HTTP 401 for /search/repositories", "hn: fetch failed"], degraded: ["triage:budget"] });
    expect(s).toMatch(/HTTP 401[\s\S]*GITHUB_TOKEN sai/);
    expect(s).toMatch(/fetch failed[\s\S]*không kết nối/);
    expect(s).toContain("hết ngân sách token");
    expect(s).toContain("Sửa các dòng [LỖI]");
  });
});
