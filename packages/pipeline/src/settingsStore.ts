import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultConfig, loadConfig, parseConfig, type Config } from "./config.js";
import { LEGACY_CATEGORIES } from "./prompts.js";
import { applyPatch, diffFromDefaults, getPath, revOf, SETTINGS, settingsView, type SettingsView } from "./settings.js";

/** Where a change came from, kept in the change log. */
export type ChangeSource = "pc" | "phone" | "web" | "restore";

export interface ChangeEntry {
  /** Also the name of the backup holding the settings as they were just before this change. */
  id: string;
  at: string;
  source: ChangeSource;
  device?: string;
  changed: string[];
}

export type SaveResult =
  | { ok: true; changed: string[]; view: SettingsView; entry: ChangeEntry | null }
  | { ok: false; conflict?: true; errors: { key: string; problem: string }[]; view: SettingsView };

const HISTORY_KEEP = 30;
const ID = /^\d{8}T\d{9}Z-[a-z]+(-\d+)?$/;

const NOTES = [
  "File này do trang Cài đặt của dashboard ghi; chỉ chứa các mục khác mặc định. Sửa tay vẫn được, rồi chạy: npm run doctor",
  "Mọi cài đặt, ý nghĩa và giới hạn: trang Cài đặt của dashboard (npm run dashboard), hoặc packages/pipeline/src/settings.ts",
];

/**
 * Reads and writes ~/.vhub-trend/config.json for the settings page. Every save validates against the catalogue,
 * refuses a stale revision, keeps the previous file in config-history/ and appends one line to the change log,
 * so any change can be undone. Writes are atomic (temp file + rename).
 */
export class SettingsStore {
  readonly historyDir: string;
  constructor(
    readonly configFile: string,
    dir: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.historyDir = join(dir, "config-history");
  }

  load(): Config {
    return loadConfig(existsSync(this.configFile) ? this.configFile : null);
  }

  view(cfg: Config = this.load()): SettingsView {
    return settingsView(cfg, LEGACY_CATEGORIES);
  }

  save(patch: unknown, o: { source: ChangeSource; origin: "local" | "remote"; baseRev?: string; device?: string }): SaveResult {
    const cur = this.load();
    if (o.baseRev && o.baseRev !== revOf(cur)) {
      return { ok: false, conflict: true, errors: [{ key: "", problem: "Cài đặt vừa được đổi ở nơi khác. Tải lại để xem bản mới rồi sửa tiếp." }], view: this.view(cur) };
    }
    const r = applyPatch(cur, patch, o.origin);
    if (r.errors.length) return { ok: false, errors: r.errors, view: this.view(cur) };
    if (!r.changed.length) return { ok: true, changed: [], view: this.view(cur), entry: null };
    const entry: ChangeEntry = { id: this.newId(o.source), at: this.now().toISOString(), source: o.source, changed: r.changed, ...(o.device ? { device: o.device.slice(0, 40) } : {}) };
    mkdirSync(this.historyDir, { recursive: true });
    writeFileSync(join(this.historyDir, `${entry.id}.json`), existsSync(this.configFile) ? readFileSync(this.configFile, "utf8") : "{}\n", { mode: 0o600 });
    this.write(r.config);
    appendFileSync(join(this.historyDir, "log.jsonl"), JSON.stringify(entry) + "\n");
    this.prune();
    return { ok: true, changed: r.changed, view: this.view(r.config), entry };
  }

  /** Newest first. */
  history(limit = 20): ChangeEntry[] {
    const file = join(this.historyDir, "log.jsonl");
    if (!existsSync(file)) return [];
    const out: ChangeEntry[] = [];
    for (const line of readFileSync(file, "utf8").split("\n")) {
      try {
        if (line.trim()) out.push(JSON.parse(line) as ChangeEntry);
      } catch {
        /* a torn last line after a crash: skip it */
      }
    }
    const kept = new Set(this.backups());
    return out.filter((e) => kept.has(e.id)).reverse().slice(0, limit);
  }

  /** Puts every setting back to how it was just before change `id`. The restore is itself a change, so it can be undone too. */
  restore(id: string): SaveResult {
    const file = join(this.historyDir, `${id}.json`);
    if (!ID.test(id) || !existsSync(file)) return { ok: false, errors: [{ key: "", problem: "Không còn bản sao lưu này." }], view: this.view() };
    let old: Config;
    try {
      old = parseConfig(readFileSync(file, "utf8"));
    } catch (e) {
      return { ok: false, errors: [{ key: "", problem: `Bản sao lưu không đọc được: ${e instanceof Error ? e.message : e}` }], view: this.view() };
    }
    // Settings only an edit of the file may change (llm.command, ...) stay as they are now.
    const patch = Object.fromEntries(SETTINGS.filter((d) => d.editable !== false).map((d) => [d.key, getPath(old, d.key)]));
    return this.save(patch, { source: "restore", origin: "local" });
  }

  private write(cfg: Config): void {
    const body = { _huong_dan: NOTES, ...diffFromDefaults(cfg) };
    const tmp = `${this.configFile}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(body, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, this.configFile);
  }

  private backups(): string[] {
    if (!existsSync(this.historyDir)) return [];
    return readdirSync(this.historyDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -5))
      .filter((id) => ID.test(id))
      .sort();
  }

  private prune(): void {
    const all = this.backups();
    for (const id of all.slice(0, Math.max(0, all.length - HISTORY_KEEP))) rmSync(join(this.historyDir, `${id}.json`), { force: true });
  }

  private newId(source: ChangeSource): string {
    const stamp = this.now().toISOString().replace(/[-:.]/g, "");
    let id = `${stamp}-${source}`;
    for (let n = 2; existsSync(join(this.historyDir, `${id}.json`)); n++) id = `${stamp}-${source}-${n}`;
    return id;
  }
}

/** For tests and the demo: the defaults as a store would see them with no file. */
export const defaultView = (): SettingsView => settingsView(defaultConfig, LEGACY_CATEGORIES);
