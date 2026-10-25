import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Db } from "../db.js";
import { sha256 } from "../text.js";
import { GenerationConflict, type BlobStore } from "./storage.js";

/**
 * Database hand-over between the PC and the cloud scan (docs/SYNC.md, "Quét trên cloud").
 *
 * The bucket holds one copy of the database. The PC uploads it after its own changes and imports the cloud's copy
 * when the cloud has scanned since; the cloud downloads it, scans, and uploads it back. Every upload is conditional on
 * the generation the writer started from, so two writers can never silently overwrite each other: the loser either
 * imports first (PC) or drops its result (cloud). What the person decided (Keep, Skip, ...) is never lost: actions
 * taken on the PC since its last upload are carried over onto the imported copy.
 */
export const DB_OBJECT = "trend.sqlite";
export const CONFIG_OBJECT = "config.json";

const GEN = "dbsync.gen";
const FP = "dbsync.fp";
const MARK = "dbsync.feedbackMark";
const CFG = "dbsync.configHash";
/** kv entries that describe this copy's own sync state; never taken from the other side. */
const LOCAL_KV = ["dbsync.", "sync.", "settings.remote"];

export interface HandOverResult {
  pulled: boolean;
  pushed: boolean;
  /** Actions taken on the PC that were carried over onto the cloud's copy. */
  carried: number;
}

/** A consistent copy of the database as bytes (VACUUM INTO also compacts it). */
export function exportDb(db: Db): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "vhub-db-"));
  try {
    const file = join(dir, "copy.sqlite");
    db.run("VACUUM INTO ?", file);
    return readFileSync(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** What changes when the database holds something worth uploading: a run, an action, an applied phone event. */
function fingerprint(db: Db): string {
  const r = db.get<Record<string, unknown>>(
    `SELECT (SELECT MAX(started_at || '|' || IFNULL(finished_at, '') || '|' || status) FROM run) AS run,
            (SELECT MAX(id) FROM feedback) AS fb, (SELECT COUNT(*) FROM cloud_event) AS ev`,
  );
  return JSON.stringify(r);
}

const maxFeedback = (db: Db): number => db.get<{ n: number | null }>("SELECT MAX(id) AS n FROM feedback")?.n ?? 0;

const tables = (db: Db, schema: string): string[] =>
  db.all<{ name: string }>(`SELECT name FROM ${schema}.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).map((r) => r.name);

const columns = (db: Db, schema: string, table: string): string[] =>
  db.all<{ name: string }>(`SELECT name FROM pragma_table_info(?, ?)`, table, schema).map((r) => r.name);

const isLocalKey = (k: string): boolean => LOCAL_KV.some((p) => k.startsWith(p));

/**
 * Replaces this database's contents with `bytes` (a copy from the bucket), keeping this side's own sync state, and
 * re-applies the person's actions recorded here after `sinceFeedbackId` unless the copy has a later one for the same item.
 */
export function importDb(db: Db, bytes: Buffer, sinceFeedbackId: number): { carried: number; mark: number } {
  const dir = mkdtempSync(join(tmpdir(), "vhub-db-"));
  const file = join(dir, "remote.sqlite");
  writeFileSync(file, bytes);
  type Local = { entity_id: string; action: string; at: string; user_state: string; snooze_until: string | null };
  // The newest local action per item, with the state it left the item in.
  const local = db.all<Local>(
    `SELECT f.entity_id, f.action, f.at, e.user_state, e.snooze_until FROM feedback f JOIN entity e ON e.id = f.entity_id
     WHERE f.id > ? AND f.id = (SELECT MAX(id) FROM feedback g WHERE g.entity_id = f.entity_id)`,
    sinceFeedbackId,
  );
  db.run("ATTACH DATABASE ? AS remote", file);
  try {
    let carried = 0;
    let mark = 0;
    db.tx(() => {
      const theirs = new Set(tables(db, "remote"));
      for (const t of tables(db, "main")) {
        if (t === "kv") continue;
        db.run(`DELETE FROM main."${t}"`);
        if (!theirs.has(t)) continue;
        const remoteCols = new Set(columns(db, "remote", t));
        const cols = columns(db, "main", t).filter((c) => remoteCols.has(c)).map((c) => `"${c}"`).join(", ");
        db.run(`INSERT INTO main."${t}" (${cols}) SELECT ${cols} FROM remote."${t}"`);
      }
      if (theirs.has("kv")) {
        for (const { key } of db.all<{ key: string }>("SELECT key FROM main.kv")) if (!isLocalKey(key)) db.run("DELETE FROM main.kv WHERE key = ?", key);
        for (const r of db.all<{ key: string; value: string }>("SELECT key, value FROM remote.kv")) {
          if (!isLocalKey(r.key)) db.kvSet(r.key, r.value);
        }
      }
      mark = maxFeedback(db);
      for (const l of local) {
        const later = db.get("SELECT 1 FROM feedback WHERE entity_id = ? AND at > ?", l.entity_id, l.at);
        if (later || !db.get("SELECT 1 FROM entity WHERE id = ?", l.entity_id)) continue;
        db.run("UPDATE entity SET user_state = ?, snooze_until = ? WHERE id = ?", l.user_state, l.snooze_until, l.entity_id);
        db.run("INSERT INTO feedback (entity_id, action, at) VALUES (?, ?, ?)", l.entity_id, l.action, l.at);
        carried++;
      }
    });
    return { carried, mark };
  } finally {
    db.run("DETACH DATABASE remote");
    rmSync(dir, { recursive: true, force: true });
  }
}

/** PC side, before anything else touches the database: takes the cloud's copy if the cloud scanned since we last looked. */
export async function pullDb(db: Db, blobs: BlobStore): Promise<{ pulled: boolean; carried: number }> {
  const gen = await blobs.generation(DB_OBJECT);
  if (gen === null) {
    // The bucket copy is gone (bucket recreated): the next upload starts a new object.
    if (db.kvGet(GEN) !== undefined) db.run("DELETE FROM kv WHERE key = ?", GEN);
    return { pulled: false, carried: 0 };
  }
  if (gen === db.kvGet(GEN)) return { pulled: false, carried: 0 };
  const got = await blobs.download(DB_OBJECT);
  if (!got) return { pulled: false, carried: 0 };
  const { carried, mark } = importDb(db, got.bytes, Number(db.kvGet(MARK) ?? "0"));
  db.kvSet(GEN, got.generation);
  // Actions carried over are newer than the copy in the bucket: they count as not uploaded yet.
  db.kvSet(MARK, String(mark));
  if (carried) db.run("DELETE FROM kv WHERE key = ?", FP);
  else db.kvSet(FP, fingerprint(db));
  return { pulled: true, carried };
}

/**
 * PC side: uploads the database when it changed since the last hand-over, and the config the cloud scan should use.
 * If the cloud uploaded in between, imports its copy first and tries once more.
 */
export async function pushDb(db: Db, blobs: BlobStore, configText: string | null): Promise<HandOverResult> {
  const res: HandOverResult = { pulled: false, pushed: false, carried: 0 };
  if (configText !== null) {
    const h = sha256(configText);
    if (h !== db.kvGet(CFG)) {
      await blobs.upload(CONFIG_OBJECT, Buffer.from(configText, "utf8"));
      db.kvSet(CFG, h);
    }
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const fp = fingerprint(db);
    if (db.kvGet(GEN) !== undefined && fp === db.kvGet(FP)) return res;
    const mark = maxFeedback(db);
    try {
      const gen = await blobs.upload(DB_OBJECT, exportDb(db), db.kvGet(GEN) ?? "0");
      db.kvSet(GEN, gen);
      db.kvSet(FP, fp);
      db.kvSet(MARK, String(mark));
      res.pushed = true;
      return res;
    } catch (e) {
      if (!(e instanceof GenerationConflict) || attempt > 0) throw e;
      const p = await pullDb(db, blobs);
      res.pulled = p.pulled;
      res.carried += p.carried;
    }
  }
  return res;
}
