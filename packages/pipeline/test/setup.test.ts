import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolveHome } from "../src/app.js";
import { defaultConfig, parseConfig } from "../src/config.js";
import { TODO_MARK, checkConfig, initGuide } from "../src/setup.js";

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
