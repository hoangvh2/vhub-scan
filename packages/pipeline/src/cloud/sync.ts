import type { Db } from "../db.js";
import type { Budget } from "../llm/budget.js";
import { USER_ACTIONS, type Clock, type UserAction } from "../model.js";
import { buildSnapshot, snapshotHash, SNAPSHOT_SCHEMA } from "../snapshot.js";
import type { SettingsStore } from "../settingsStore.js";
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
  /** Settings changes from the phone or hosted page applied in this sync. */
  settingsApplied?: number;
  error?: string;
}

/** Outcome of the last settings change sent from the phone or the hosted page; published in the snapshot so the sender sees it. */
export interface RemoteSettingsResult {
  id: string;
  /** When the device sent it (ms) and when the PC applied it. */
  sentAt: number;
  appliedAt: string;
  device: string | null;
  ok: boolean;
  changed: string[];
  errors: { key: string; problem: string }[];
}

export interface SyncDeps {
  db: Db;
  store: Store;
  budget: Budget;
  docs: DocStore;
  uid: string;
  clock: Clock;
  /** When set, settings changes from the phone are applied to config.json and the settings travel in the snapshot. */
  settings?: SettingsStore;
  log?: (m: string) => void;
}

const LAST = "sync.last";
const HASH = "sync.hash";
const REMOTE = "settings.remote";
/** owners/{uid}/settingsInbox/{id}: { patch: JSON string of setting key -> value, baseRev, at, device? }. Contract: docs/SYNC.md. */
export const SETTINGS_INBOX = "settingsInbox";

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
    if (d.settings) res.settingsApplied = await applyRemoteSettings(d, d.settings);

    const snap = buildSnapshot(d.db, d.store, d.budget, now, { settings: d.settings ? { ...d.settings.view(), remote: lastRemoteSettings(d.db) } : undefined });
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

/**
 * Applies settings changes sent from the phone or the hosted page, oldest first, each at most once. A change is a patch
 * of only the settings the person edited; it is validated against the catalogue exactly like a change on the PC, and
 * settings marked PC-only are refused. Concurrent edits: the later one wins per setting. Returns how many were applied.
 */
export async function applyRemoteSettings(d: Pick<SyncDeps, "db" | "docs" | "uid" | "clock" | "log">, settings: SettingsStore): Promise<number> {
  const docs = await d.docs.list(`owners/${d.uid}/${SETTINGS_INBOX}`);
  let applied = 0;
  for (const e of [...docs].sort(byTime)) {
    if (!d.db.get("SELECT 1 FROM cloud_event WHERE id = ?", e.id)) {
      const device = typeof e.fields.device === "string" ? e.fields.device.slice(0, 40) : null;
      const sentAt = typeof e.fields.at === "number" ? e.fields.at : 0;
      let patch: unknown = null;
      try {
        patch = JSON.parse(typeof e.fields.patch === "string" ? e.fields.patch : "null");
      } catch {
        /* reported below as invalid */
      }
      const r = settings.save(patch, { source: device === "web" ? "web" : "phone", origin: "remote", device: device ?? undefined });
      const result: RemoteSettingsResult = {
        id: e.id, sentAt, appliedAt: d.clock.now().toISOString(), device, ok: r.ok,
        changed: r.ok ? r.changed : [], errors: r.ok ? [] : r.errors,
      };
      d.db.run(
        "INSERT INTO cloud_event (id, entity_id, action, applied_at, result) VALUES (?, 'settings', 'settings', ?, ?)",
        e.id,
        result.appliedAt,
        r.ok ? "applied" : "rejected",
      );
      d.db.kvSet(REMOTE, JSON.stringify(result));
      if (r.ok) applied++;
      d.log?.(r.ok ? `cài đặt từ ${device ?? "điện thoại"}: đổi ${r.changed.join(", ") || "không có gì"}` : `cài đặt từ ${device ?? "điện thoại"} bị từ chối: ${r.errors.map((x) => `${x.key} ${x.problem}`).join("; ")}`);
    }
    await d.docs.remove([e.name]);
  }
  return applied;
}

export function lastRemoteSettings(db: Db): RemoteSettingsResult | null {
  const v = db.kvGet(REMOTE);
  return v ? (JSON.parse(v) as RemoteSettingsResult) : null;
}
