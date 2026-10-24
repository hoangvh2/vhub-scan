import type { Db } from "../db.js";
import type { Budget } from "../llm/budget.js";
import { USER_ACTIONS, type Clock, type UserAction } from "../model.js";
import { buildSnapshot, snapshotHash, SNAPSHOT_SCHEMA } from "../snapshot.js";
import type { Store } from "../store.js";
import type { DocStore, FsDoc } from "./firestore.js";

export interface SyncResult {
  at: string;
  ok: boolean;
  /** Phone actions applied to the local database in this sync. */
  applied: number;
  /** Phone actions that were not valid (unknown item or action); removed from the inbox. */
  rejected: number;
  /** Whether a new snapshot was uploaded (false when nothing changed). */
  pushed: boolean;
  bytes: number;
  error?: string;
}

export interface SyncDeps {
  db: Db;
  store: Store;
  budget: Budget;
  docs: DocStore;
  uid: string;
  clock: Clock;
  log?: (m: string) => void;
}

const LAST = "sync.last";
const HASH = "sync.hash";

/**
 * One round trip: apply what the phone did while away (inbox), then publish the PC's current view.
 * Safe to repeat or to interrupt anywhere: each phone event is applied at most once (cloud_event),
 * and the snapshot is uploaded only when its content changed.
 */
export async function syncOnce(d: SyncDeps): Promise<SyncResult> {
  const now = d.clock.now();
  const res: SyncResult = { at: now.toISOString(), ok: false, applied: 0, rejected: 0, pushed: false, bytes: 0 };
  try {
    const events = await d.docs.list(`owners/${d.uid}/inbox`);
    const done: string[] = [];
    for (const e of [...events].sort(byTime)) {
      const r = applyEvent(d, e, now);
      if (r === "applied") res.applied++;
      if (r === "rejected") res.rejected++;
      done.push(e.name);
    }
    if (done.length) await d.docs.remove(done);

    const snap = buildSnapshot(d.db, d.store, d.budget, now);
    const hash = snapshotHash(snap);
    const payload = JSON.stringify(snap);
    res.bytes = Buffer.byteLength(payload);
    if (hash !== d.db.kvGet(HASH)) {
      await d.docs.set(`owners/${d.uid}/snapshot/latest`, { schema: SNAPSHOT_SCHEMA, generatedAt: snap.generatedAt, day: snap.day, payload });
      d.db.kvSet(HASH, hash);
      res.pushed = true;
    }
    res.ok = true;
  } catch (e) {
    res.error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
  }
  d.db.kvSet(LAST, JSON.stringify(res));
  d.log?.(`sync: ${res.ok ? "ok" : "LỖI " + res.error} · áp dụng ${res.applied} thao tác từ điện thoại · ${res.pushed ? "đã đẩy" : "không đổi"} snapshot (${Math.round(res.bytes / 1024)} KB)`);
  return res;
}

const byTime = (a: FsDoc, b: FsDoc): number => Number(a.fields.at ?? 0) - Number(b.fields.at ?? 0) || a.id.localeCompare(b.id);

function applyEvent(d: SyncDeps, e: FsDoc, now: Date): "applied" | "rejected" | "duplicate" {
  if (d.db.get("SELECT 1 FROM cloud_event WHERE id = ?", e.id)) return "duplicate";
  const entityId = typeof e.fields.entityId === "string" ? e.fields.entityId : "";
  const action = typeof e.fields.action === "string" ? e.fields.action : "";
  const at = typeof e.fields.at === "number" && e.fields.at > 0 ? new Date(Math.min(e.fields.at, now.getTime())) : now;
  const days = typeof e.fields.days === "number" ? Math.max(1, Math.min(90, e.fields.days)) : 7;
  const valid = (USER_ACTIONS as readonly string[]).includes(action);
  const ok = valid && d.store.applyFeedback(entityId, action as UserAction, at, days);
  d.db.run(
    "INSERT INTO cloud_event (id, entity_id, action, applied_at, result) VALUES (?, ?, ?, ?, ?)",
    e.id,
    entityId.slice(0, 300),
    action.slice(0, 20),
    now.toISOString(),
    ok ? "applied" : "rejected",
  );
  return ok ? "applied" : "rejected";
}

export function lastSync(db: Db): SyncResult | null {
  const v = db.kvGet(LAST);
  return v ? (JSON.parse(v) as SyncResult) : null;
}
