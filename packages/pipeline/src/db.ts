import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Param = SQLInputValue;

/** Thin wrapper over node:sqlite so the rest of the code does not depend on its (experimental) API directly. */
export class Db {
  readonly raw: DatabaseSync;

  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.raw.exec(SCHEMA);
  }

  run(sql: string, ...p: Param[]): void {
    this.raw.prepare(sql).run(...p);
  }
  get<T>(sql: string, ...p: Param[]): T | undefined {
    return this.raw.prepare(sql).get(...p) as T | undefined;
  }
  all<T>(sql: string, ...p: Param[]): T[] {
    return this.raw.prepare(sql).all(...p) as T[];
  }

  /** All-or-nothing: a crash inside leaves the database as it was. */
  tx<T>(fn: () => T): T {
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      this.raw.exec("COMMIT");
      return r;
    } catch (e) {
      this.raw.exec("ROLLBACK");
      throw e;
    }
  }

  kvGet(key: string): string | undefined {
    return this.get<{ value: string }>("SELECT value FROM kv WHERE key = ?", key)?.value;
  }
  kvSet(key: string, value: string): void {
    this.run("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
  }

  close(): void {
    this.raw.close();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS entity (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  url TEXT NOT NULL,
  author TEXT,
  language TEXT,
  license TEXT,
  topics TEXT NOT NULL DEFAULT '[]',
  body TEXT,
  created_at TEXT,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  simhash TEXT,
  merged_into TEXT,
  stage TEXT NOT NULL DEFAULT 'normalized',
  drop_reason TEXT,
  content_hash TEXT NOT NULL,
  from_seed INTEGER NOT NULL DEFAULT 0,
  heuristic REAL,
  triage_score INTEGER,
  triage_cat TEXT,
  triage_why TEXT,
  triage_hash TEXT,
  card_json TEXT,
  card_hash TEXT,
  user_state TEXT NOT NULL DEFAULT 'new',
  snooze_until TEXT,
  shown_at TEXT,
  shown_stars INTEGER
);
CREATE INDEX IF NOT EXISTS entity_stage ON entity(stage, user_state);
CREATE TABLE IF NOT EXISTS alias (key TEXT PRIMARY KEY, entity_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sighting (
  entity_id TEXT NOT NULL,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  url TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  metrics TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (entity_id, source, source_id)
);
CREATE TABLE IF NOT EXISTS observation (
  entity_id TEXT NOT NULL,
  day TEXT NOT NULL,
  stars INTEGER,
  forks INTEGER,
  points INTEGER,
  comments INTEGER,
  PRIMARY KEY (entity_id, day)
);
CREATE TABLE IF NOT EXISTS cursor (source TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (source, key));
CREATE TABLE IF NOT EXISTS llm_cache (
  key TEXT PRIMARY KEY, output TEXT NOT NULL, in_tokens INTEGER NOT NULL, out_tokens INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS token_usage (
  day TEXT NOT NULL, stage TEXT NOT NULL, in_tokens INTEGER NOT NULL DEFAULT 0, out_tokens INTEGER NOT NULL DEFAULT 0,
  calls INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0, PRIMARY KEY (day, stage)
);
CREATE TABLE IF NOT EXISTS run (
  id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL, stage TEXT NOT NULL DEFAULT '',
  stats TEXT NOT NULL DEFAULT '{}', error TEXT, heartbeat TEXT NOT NULL, pid INTEGER
);
CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_id TEXT NOT NULL, action TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cloud_event (id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, action TEXT NOT NULL, applied_at TEXT NOT NULL, result TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS digest (
  day TEXT NOT NULL, entity_id TEXT NOT NULL, rank INTEGER NOT NULL, reason TEXT NOT NULL, PRIMARY KEY (day, entity_id)
);
`;
