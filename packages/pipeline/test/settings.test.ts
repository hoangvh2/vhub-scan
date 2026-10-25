import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { categories, defaultConfig, includeTerms, parseConfig, searchQueries, type Config } from "../src/config.js";
import { recheckRules, runPipeline } from "../src/pipeline.js";
import { triageSchema } from "../src/prompts.js";
import { applyPatch, diffFromDefaults, estimateRun, getPath, SETTINGS, settingDef, slugify, validateValue } from "../src/settings.js";
import { SettingsStore } from "../src/settingsStore.js";
import { cfgWith, NOW, rig } from "./helpers.js";
import { cfg as worldCfg, world } from "./world.js";

function leaves(o: unknown, prefix = ""): string[] {
  if (o && typeof o === "object" && !Array.isArray(o)) return Object.entries(o).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
  return [prefix];
}

const tmpHome = () => {
  const dir = mkdtempSync(join(tmpdir(), "vhub-settings-"));
  return { dir, file: join(dir, "config.json") };
};

describe("settings catalogue", () => {
  it("describes every config field exactly once, in Vietnamese, and the defaults are valid", () => {
    const keys = SETTINGS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.sort()).toEqual(leaves(defaultConfig).sort());
    for (const d of SETTINGS) {
      expect(d.label.length, d.key).toBeGreaterThan(2);
      expect(d.help.length, d.key).toBeGreaterThan(20);
      expect(validateValue(d, getPath(defaultConfig, d.key)), d.key).toBeNull();
    }
  });

  it("checks types and ranges with messages a person can act on", () => {
    expect(validateValue(settingDef("funnel.triageTop")!, 500)).toBe("lớn nhất là 200");
    expect(validateValue(settingDef("funnel.triageTop")!, 2.5)).toBe("phải là số nguyên");
    expect(validateValue(settingDef("funnel.triageTop")!, "40")).toBe("phải là số");
    expect(validateValue(settingDef("scope.exclude")!, ["video", " "])).toBe("có mục để trống");
    expect(validateValue(settingDef("llm.cardModel")!, "claude-sonnet-5-5")).toBeNull(); // a full model id is allowed
    expect(validateValue(settingDef("llm.cardModel")!, "rm -rf /")).toMatch(/chọn một trong/);
    expect(validateValue(settingDef("llm.cardEffort")!, "ultra")).toMatch(/chọn một trong/);
  });

  it("checks topics: ids are slugs, unique, not 'other'; labels and lists are bounded", () => {
    const d = settingDef("topics")!;
    const t = { id: "finance", label: "Tài chính", enabled: true, queries: ["topic:finance"], keywords: ["budget"] };
    expect(validateValue(d, [t])).toBeNull();
    expect(validateValue(d, [t, t])).toMatch(/bị trùng/);
    expect(validateValue(d, [{ ...t, id: "Tài chính" }])).toMatch(/chữ thường không dấu/);
    expect(validateValue(d, [{ ...t, id: "other" }])).toMatch(/nhóm Khác/);
    expect(validateValue(d, [{ ...t, label: "" }])).toMatch(/tên từ 1 đến 40/);
    expect(validateValue(d, [{ ...t, queries: Array(11).fill("q") }])).toMatch(/tối đa 10 query/);
    expect(validateValue(d, [{ ...t, extra: 1 }])).toMatch(/không biết trường extra/);
    expect(slugify("Tài chính cá nhân")).toBe("tai-chinh-ca-nhan");
    expect(slugify("Đọc sách & ghi chú")).toBe("doc-sach-ghi-chu");
  });

  it("applies a patch all or nothing, and reports which settings changed", () => {
    const base = cfgWith();
    const ok = applyPatch(base, { "funnel.digestSize": 7, "budget.dailyTokens": base.budget.dailyTokens }, "local");
    expect(ok.errors).toEqual([]);
    expect(ok.changed).toEqual(["funnel.digestSize"]);
    expect(ok.config.funnel.digestSize).toBe(7);
    expect(base.funnel.digestSize).toBe(5); // the input is not mutated

    const bad = applyPatch(base, { "funnel.digestSize": 7, "funnel.cardTop": 999, nope: 1 }, "local");
    expect(bad.config).toBe(base);
    expect(bad.errors.map((e) => e.key).sort()).toEqual(["funnel.cardTop", "nope"]);
  });

  it("never lets a page change the Claude command, and keeps PC-only settings off the phone", () => {
    expect(applyPatch(cfgWith(), { "llm.command": "/tmp/evil" }, "local").errors[0]!.problem).toMatch(/config.json/);
    expect(applyPatch(cfgWith(), { "llm.command": "/tmp/evil" }, "remote").errors).toHaveLength(1);
    expect(applyPatch(cfgWith(), { "server.port": 5000 }, "remote").errors[0]!.problem).toMatch(/dashboard của PC/);
    expect(applyPatch(cfgWith(), { "server.port": 5000 }, "local").changed).toEqual(["server.port"]);
  });

  it("writes only what differs from the defaults, and that round-trips", () => {
    const c = applyPatch(defaultConfig, { "funnel.digestSize": 8, "sources.github.seeds": ["simonw"] }, "local").config;
    const diff = diffFromDefaults(c);
    expect(diff).toEqual({ funnel: { digestSize: 8 }, sources: { github: { seeds: ["simonw"] } } });
    expect(parseConfig(JSON.stringify(diff))).toEqual(c);
  });

  it("estimates more tokens for a wider funnel and fewer for a narrower one", () => {
    const base = estimateRun(defaultConfig);
    expect(base.triageCalls).toBe(2);
    expect(base.cardCalls).toBe(2);
    expect(base.searches).toBe(3);
    const wide = estimateRun(applyPatch(defaultConfig, { "funnel.triageTop": 80 }, "local").config);
    const off = estimateRun(applyPatch(defaultConfig, { "funnel.triageTop": 0, "funnel.cardTop": 0 }, "local").config);
    expect(wide.tokens).toBeGreaterThan(base.tokens);
    expect(off.tokens).toBe(0);
  });
});

describe("topics", () => {
  const withTopics = (): Config => {
    const c = cfgWith();
    c.sources.github.queries = ["topic:productivity created:>{d14} stars:>=5", "topic:extra"];
    c.topics[2]!.enabled = false;
    return c;
  };
  it("searches each enabled topic's queries and the extra ones, each once", () => {
    expect(searchQueries(withTopics())).toEqual(["topic:claude-code created:>{d14} stars:>=3", "topic:productivity created:>{d14} stars:>=5", "topic:extra"]);
  });
  it("adds enabled topics' keywords to the include list and offers their ids as categories", () => {
    const c = withTopics();
    expect(includeTerms(c)).toContain("mcp");
    expect(includeTerms(c)).not.toContain("automation" + "-only-in-disabled"); // sanity
    expect(categories(c).map((x) => x.id)).toEqual(["claude-code", "productivity", "other"]);
    expect((triageSchema(c).properties.items.items.properties.c as { enum: string[] }).enum).toEqual(["claude-code", "productivity", "other"]);
  });
  it("files triaged items under a topic id", async () => {
    const c = worldCfg();
    c.topics = [{ id: "planning", label: "Lập kế hoạch", enabled: true, queries: [], keywords: ["planner"] }];
    const r = rig({ cfg: c, ...world() });
    await runPipeline(r.deps);
    const cats = r.db.all<{ triage_cat: string }>("SELECT DISTINCT triage_cat FROM entity WHERE triage_cat IS NOT NULL").map((x) => x.triage_cat).sort();
    expect(cats).toEqual(["planning"]); // the fake files everything it likes under the first category
    expect(r.fake.calls[0]!.system).toContain("planning (Lập kế hoạch)");
  });
});

describe("changing the filter rules re-checks items already seen", () => {
  it("drops newly excluded items, brings back items no longer excluded, never touches what the user decided", async () => {
    const r = rig({ cfg: worldCfg(), ...world() });
    await runPipeline(r.deps);
    const stage = (id: string) => r.db.get<{ stage: string; drop_reason: string | null }>("SELECT stage, drop_reason FROM entity WHERE id = ?", id)!;
    expect(stage("github:acme/video-studio").stage).toBe("dropped");
    expect(stage("github:lifehub/planner").stage).not.toBe("dropped");
    r.store.applyFeedback("github:acme/taskflow", "keep", NOW);

    // Two descriptions now excluded (lifehub/planner and the Show HN post "Habito"), and "video" allowed again.
    const c2 = structuredClone(r.cfg);
    c2.scope.exclude = [...c2.scope.exclude.filter((w) => w !== "video"), "calendar assistant", "command line assistant"];
    expect(recheckRules(r, c2, NOW, true)).toEqual({ dropped: 2, revived: 1 }); // dry run: counts only
    expect(stage("github:lifehub/planner").stage).not.toBe("dropped");

    r.clock.advanceDays(1);
    const st = await runPipeline({ ...r.deps, cfg: c2 });
    expect(st.recheck).toEqual({ dropped: 2, revived: 1 });
    expect(stage("github:lifehub/planner")).toMatchObject({ stage: "dropped", drop_reason: "out_of_scope:calendar assistant" });
    expect(stage("github:acme/video-studio").stage).not.toBe("dropped");
    expect(stage("github:acme/taskflow").stage).not.toBe("dropped"); // kept by the user, though it now matches

    // Same rules again: nothing to re-check.
    r.clock.advanceDays(1);
    expect((await runPipeline({ ...r.deps, cfg: c2 })).recheck).toBeNull();
  });
});

describe("settings file", () => {
  it("saves a change: valid only, previous file backed up, change logged, notes kept at the top", () => {
    const h = tmpHome();
    writeFileSync(h.file, JSON.stringify({ projects: [{ name: "VH Flow", summary: "App quản lý việc" }] }));
    const s = new SettingsStore(h.file, h.dir, () => NOW);
    const v0 = s.view();
    const r = s.save({ "funnel.digestSize": 9 }, { source: "pc", origin: "local", baseRev: v0.rev });
    expect(r.ok).toBe(true);
    const written = JSON.parse(readFileSync(h.file, "utf8"));
    expect(written).toMatchObject({ funnel: { digestSize: 9 }, projects: [{ name: "VH Flow" }] });
    expect(written._huong_dan[0]).toMatch(/trang Cài đặt/);
    expect(s.load().funnel.digestSize).toBe(9);
    const [entry] = s.history();
    expect(entry).toMatchObject({ source: "pc", changed: ["funnel.digestSize"] });
    expect(JSON.parse(readFileSync(join(s.historyDir, `${entry!.id}.json`), "utf8"))).toEqual({ projects: [{ name: "VH Flow", summary: "App quản lý việc" }] });

    const bad = s.save({ "funnel.digestSize": 0 }, { source: "pc", origin: "local" });
    expect(bad).toMatchObject({ ok: false, errors: [{ key: "funnel.digestSize", problem: "nhỏ nhất là 1" }] });
    expect(s.load().funnel.digestSize).toBe(9);
  });

  it("refuses a save based on an older revision (someone saved in between)", () => {
    const h = tmpHome();
    const s = new SettingsStore(h.file, h.dir, () => NOW);
    const rev = s.view().rev;
    expect(s.save({ "funnel.digestSize": 6 }, { source: "pc", origin: "local", baseRev: rev }).ok).toBe(true);
    const late = s.save({ "funnel.cardTop": 3 }, { source: "pc", origin: "local", baseRev: rev });
    expect(late).toMatchObject({ ok: false, conflict: true });
    expect(s.load().funnel.cardTop).toBe(defaultConfig.funnel.cardTop);
  });

  it("restores the settings from before a change, and the restore can itself be undone", () => {
    const h = tmpHome();
    let t = NOW.getTime();
    const s = new SettingsStore(h.file, h.dir, () => new Date((t += 1000)));
    s.save({ "funnel.digestSize": 6 }, { source: "pc", origin: "local" });
    s.save({ "funnel.digestSize": 7, "scope.exclude": ["video"] }, { source: "phone", origin: "remote", device: "Pixel 8" });
    const [last] = s.history();
    expect(last).toMatchObject({ source: "phone", device: "Pixel 8" });
    const r = s.restore(last!.id);
    expect(r.ok).toBe(true);
    expect(s.load().funnel.digestSize).toBe(6);
    expect(s.load().scope.exclude).toEqual(defaultConfig.scope.exclude);
    expect(s.history()[0]).toMatchObject({ source: "restore" });
    expect(s.restore("../../etc/passwd").ok).toBe(false);
  });

  it("keeps the last 30 backups", () => {
    const h = tmpHome();
    let t = NOW.getTime();
    const s = new SettingsStore(h.file, h.dir, () => new Date((t += 1000)));
    for (let i = 0; i < 35; i++) s.save({ "funnel.digestSize": (i % 20) + 1 }, { source: "pc", origin: "local" });
    expect(readdirSync(s.historyDir).filter((f) => f.endsWith(".json"))).toHaveLength(30);
    expect(s.history(100)).toHaveLength(30);
  });

  it("a page save leaves a hand-set Claude command alone", () => {
    const h = tmpHome();
    writeFileSync(h.file, JSON.stringify({ llm: { command: "C:\\tools\\claude.exe" } }));
    const s = new SettingsStore(h.file, h.dir, () => NOW);
    s.save({ "funnel.digestSize": 4 }, { source: "pc", origin: "local" });
    expect(s.load().llm.command).toBe("C:\\tools\\claude.exe");
    expect(existsSync(h.file)).toBe(true);
  });
});
