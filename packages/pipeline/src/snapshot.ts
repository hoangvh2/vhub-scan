import { createHash } from "node:crypto";
import type { Db } from "./db.js";
import type { Budget } from "./llm/budget.js";
import type { UserState } from "./model.js";
import type { SettingsView } from "./settings.js";
import type { Store } from "./store.js";
import { digestFor, listEntities, type EntityView } from "./views.js";

/**
 * Everything a phone needs, in one JSON document. Served live over the LAN (GET /api/snapshot) and
 * published to Firestore (owners/{uid}/snapshot/latest, field `payload`), so the app has one model
 * for both. Contract: docs/SYNC.md. Bump SNAPSHOT_SCHEMA on any breaking change.
 */
export const SNAPSHOT_SCHEMA = 1;
/** Firestore documents are limited to 1 MiB; leave room for the other fields. */
export const SNAPSHOT_MAX_BYTES = 900_000;

export interface SnapshotItem extends EntityView {
  /** Stars (GitHub) or points (HN) per observed day, oldest first, at most 30. */
  series: number[];
}

export interface SnapshotRun {
  startedAt: string;
  finishedAt: string | null;
  status: string;
  error: string | null;
  collected: number;
  created: number;
  merged: number;
  triaged: number;
  carded: number;
  digest: number;
  llmCalls: number;
  cacheHits: number;
  dropped: Record<string, number>;
  degraded: string[];
  sourceErrors: string[];
}

export interface Snapshot {
  schema: number;
  generatedAt: string;
  day: string | null;
  digest: SnapshotItem[];
  /** Kept and trying. */
  kept: SnapshotItem[];
  /** Best analysed items still waiting for a decision, for browsing away from home. */
  explore: SnapshotItem[];
  health: {
    lastRun: SnapshotRun | null;
    tokens: { used: number; limit: number; calls: number; costUsd: number };
    counts: Record<UserState, number>;
  };
  /** The settings form (catalogue + values) and the outcome of the last change sent from a device. Absent when the PC did not pass them. */
  settings?: SnapshotSettings;
}

export interface SnapshotSettings extends SettingsView {
  remote: {
    id: string;
    sentAt: number;
    appliedAt: string;
    device: string | null;
    ok: boolean;
    changed: string[];
    errors: { key: string; problem: string }[];
  } | null;
}

function withSeries(store: Store, v: EntityView): SnapshotItem {
  const series = store
    .observations(v.id)
    .slice(-30)
    .map((o) => o.stars ?? o.points ?? 0);
  return { ...v, series };
}

export function buildSnapshot(db: Db, store: Store, budget: Budget, now: Date, opts: { maxBytes?: number; settings?: SnapshotSettings } = {}): Snapshot {
  const d = digestFor(db, store);
  const kept = [...listEntities(db, store, { state: "kept", limit: 200 }), ...listEntities(db, store, { state: "trying", limit: 200 })];
  const seen = new Set([...d.items, ...kept].map((v) => v.id));
  const explore = listEntities(db, store, { state: "new", limit: 120 }).filter((v) => !seen.has(v.id) && v.triage.score !== null);

  const run = db.get<{ started_at: string; finished_at: string | null; status: string; stats: string; error: string | null }>(
    "SELECT started_at, finished_at, status, stats, error FROM run ORDER BY started_at DESC LIMIT 1",
  );
  const st = run ? (JSON.parse(run.stats) as Partial<SnapshotRun>) : {};
  const counts = { new: 0, kept: 0, skipped: 0, snoozed: 0, trying: 0, done: 0 } as Record<UserState, number>;
  for (const r of db.all<{ user_state: UserState; n: number }>("SELECT user_state, COUNT(*) AS n FROM entity WHERE stage != 'dropped' GROUP BY user_state")) {
    counts[r.user_state] = r.n;
  }
  const t = budget.today(now);

  const snap: Snapshot = {
    schema: SNAPSHOT_SCHEMA,
    generatedAt: now.toISOString(),
    day: d.day,
    digest: d.items.map((v) => withSeries(store, v)),
    kept: kept.map((v) => withSeries(store, v)),
    explore: explore.map((v) => withSeries(store, v)),
    health: {
      lastRun: run
        ? {
            startedAt: run.started_at,
            finishedAt: run.finished_at,
            status: run.status,
            error: run.error,
            collected: st.collected ?? 0,
            created: st.created ?? 0,
            merged: st.merged ?? 0,
            triaged: st.triaged ?? 0,
            carded: st.carded ?? 0,
            digest: st.digest ?? 0,
            llmCalls: st.llmCalls ?? 0,
            cacheHits: st.cacheHits ?? 0,
            dropped: st.dropped ?? {},
            degraded: st.degraded ?? [],
            sourceErrors: st.sourceErrors ?? [],
          }
        : null,
      tokens: { used: t.inTokens + t.outTokens, limit: t.limit, calls: t.calls, costUsd: t.costUsd },
      counts,
    },
    ...(opts.settings ? { settings: opts.settings } : {}),
  };
  // Fit into one Firestore document: drop explore items first, then the lowest-ranked kept ones. The digest always stays.
  const max = opts.maxBytes ?? SNAPSHOT_MAX_BYTES;
  while (Buffer.byteLength(JSON.stringify(snap)) > max && (snap.explore.length || snap.kept.length)) {
    if (snap.explore.length) snap.explore.splice(-Math.max(1, Math.ceil(snap.explore.length / 4)));
    else snap.kept.splice(-Math.max(1, Math.ceil(snap.kept.length / 4)));
  }
  return snap;
}

/** Hash of the content, ignoring when it was generated: unchanged data is not uploaded again. */
export function snapshotHash(s: Snapshot): string {
  return createHash("sha256").update(JSON.stringify({ ...s, generatedAt: "" })).digest("hex").slice(0, 32);
}
