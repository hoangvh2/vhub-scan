import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONFIG_OBJECT, DB_OBJECT, exportDb, importDb, pullDb, pushDb } from "../src/cloud/dbsync.js";
import { Db } from "../src/db.js";
import { runPipeline } from "../src/pipeline.js";
import { Store } from "../src/store.js";
import { NOW, rig } from "./helpers.js";
import { syncOnce } from "../src/cloud/sync.js";
import { MemoryBlobs, MemoryDocs } from "./memory.js";
import { cfg, world } from "./world.js";

async function pc() {
  const r = rig({ cfg: cfg(), ...world() });
  await runPipeline(r.deps);
  return r;
}

/** What the cloud scan does with the bucket copy: open it, change it, upload it back on the generation it started from. */
async function cloudEdits(blobs: MemoryBlobs, edit: (db: Db) => void) {
  const got = (await blobs.download(DB_OBJECT))!;
  const file = join(mkdtempSync(join(tmpdir(), "cloud-")), "trend.sqlite");
  writeFileSync(file, got.bytes);
  const db = new Db(file);
  edit(db);
  await blobs.upload(DB_OBJECT, exportDb(db), got.generation);
  db.close();
}

const state = (db: Db, id: string) => db.get<{ user_state: string; snooze_until: string | null }>("SELECT user_state, snooze_until FROM entity WHERE id = ?", id);

describe("database hand-over", () => {
  it("uploads the first time as a new object, then only when something changed, plus the config when it changed", async () => {
    const { db, store } = await pc();
    const blobs = new MemoryBlobs();
    expect((await pushDb(db, blobs, '{"a":1}')).pushed).toBe(true);
    expect(blobs.uploads).toEqual([{ name: CONFIG_OBJECT, ifGeneration: undefined }, { name: DB_OBJECT, ifGeneration: "0" }]);
    expect((await pushDb(db, blobs, '{"a":1}')).pushed).toBe(false);
    expect(blobs.uploads).toHaveLength(2);
    store.applyFeedback("github:acme/taskflow", "keep", NOW);
    expect((await pushDb(db, blobs, '{"a":2}')).pushed).toBe(true);
    expect(blobs.uploads.slice(2)).toEqual([{ name: CONFIG_OBJECT, ifGeneration: undefined }, { name: DB_OBJECT, ifGeneration: "101" }]);
  });

  it("imports what the cloud scan did, and keeps the PC's own sync state", async () => {
    const { db } = await pc();
    db.kvSet("sync.hash", "pc-snapshot-hash");
    const blobs = new MemoryBlobs();
    await pushDb(db, blobs, null);
    await cloudEdits(blobs, (c) => {
      c.run("UPDATE entity SET triage_why = 'from the cloud' WHERE id = 'github:lifehub/planner'");
      c.run("INSERT INTO run (id, started_at, status, heartbeat) VALUES ('cloud-1', '2026-10-24T05:00:00Z', 'ok', '2026-10-24T05:01:00Z')");
      c.kvSet("sync.hash", "cloud-snapshot-hash");
      c.kvSet("rules.fingerprint.test", "from-cloud");
    });
    const r = await pullDb(db, blobs);
    expect(r.pulled).toBe(true);
    expect(db.get<{ triage_why: string }>("SELECT triage_why FROM entity WHERE id = 'github:lifehub/planner'")!.triage_why).toBe("from the cloud");
    expect(db.get("SELECT 1 FROM run WHERE id = 'cloud-1'")).toBeTruthy();
    expect(db.kvGet("sync.hash")).toBe("pc-snapshot-hash");
    expect(db.kvGet("rules.fingerprint.test")).toBe("from-cloud");
    // Nothing new on the PC since: no second download, no upload.
    expect((await pullDb(db, blobs)).pulled).toBe(false);
    expect((await pushDb(db, blobs, null)).pushed).toBe(false);
  });

  it("carries the PC's actions since its last upload onto the cloud copy, unless the cloud has a later action for the item", async () => {
    const { db, store } = await pc();
    const blobs = new MemoryBlobs();
    await pushDb(db, blobs, null);
    // On the PC, after the upload (for example just before it was switched off):
    store.applyFeedback("github:acme/taskflow", "snooze", new Date(NOW.getTime() + 1_000), 30);
    store.applyFeedback("github:lifehub/planner", "keep", new Date(NOW.getTime() + 1_000));
    // Meanwhile the cloud applied a later phone action on one of them:
    await cloudEdits(blobs, (c) => new Store(c, cfg()).applyFeedback("github:lifehub/planner", "skip", new Date(NOW.getTime() + 60_000)));
    const pcSnooze = state(db, "github:acme/taskflow")!.snooze_until;

    const r = await pullDb(db, blobs);
    expect(r.carried).toBe(1);
    expect(state(db, "github:acme/taskflow")).toEqual({ user_state: "snoozed", snooze_until: pcSnooze });
    expect(state(db, "github:lifehub/planner")!.user_state).toBe("skipped");
    // The carried action is now part of this copy and goes up with the next upload.
    expect((await pushDb(db, blobs, null)).pushed).toBe(true);
  });

  it("when the cloud uploaded in between, imports first and then uploads, without losing the PC's action", async () => {
    const { db, store } = await pc();
    const blobs = new MemoryBlobs();
    await pushDb(db, blobs, null);
    await cloudEdits(blobs, (c) => c.run("UPDATE entity SET triage_why = 'cloud' WHERE id = 'github:lifehub/planner'"));
    store.applyFeedback("github:acme/taskflow", "keep", new Date(NOW.getTime() + 5_000));
    const r = await pushDb(db, blobs, null);
    expect(r).toMatchObject({ pulled: true, pushed: true, carried: 1 });
    expect(state(db, "github:acme/taskflow")!.user_state).toBe("kept");
    expect(db.get<{ triage_why: string }>("SELECT triage_why FROM entity WHERE id = 'github:lifehub/planner'")!.triage_why).toBe("cloud");
  });

  it("starts over when the bucket copy was deleted", async () => {
    const { db, store } = await pc();
    const blobs = new MemoryBlobs();
    await pushDb(db, blobs, null);
    blobs.objects.clear();
    store.applyFeedback("github:acme/taskflow", "keep", NOW);
    expect((await pullDb(db, blobs)).pulled).toBe(false);
    expect((await pushDb(db, blobs, null)).pushed).toBe(true);
    expect(blobs.uploads.at(-1)).toEqual({ name: DB_OBJECT, ifGeneration: "0" });
  });

  it("an import is all-or-nothing", async () => {
    const { db } = await pc();
    const before = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM entity")!.n;
    expect(() => importDb(db, Buffer.from("not a database"), 0)).toThrow();
    expect(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM entity")!.n).toBe(before);
  });

  it("sync takes the cloud's copy before applying phone actions, then shares the result and publishes it", async () => {
    const { db, store, deps } = await pc();
    const blobs = new MemoryBlobs();
    const docs = new MemoryDocs();
    const sync = () => syncOnce({ db, store, budget: deps.budget, docs, uid: "owner", clock: deps.clock, handOver: { blobs, config: () => '{"a":1}' } });
    expect((await sync()).db).toEqual({ pulled: false, pushed: true, carried: 0 });
    await cloudEdits(blobs, (c) => c.run("UPDATE entity SET triage_why = 'cloud' WHERE id = 'github:lifehub/planner'"));
    docs.docs.set("owners/owner/inbox/evt_0123456789", { entityId: "github:lifehub/planner", action: "keep", at: NOW.getTime() });
    const r = await sync();
    expect(r).toMatchObject({ ok: true, applied: 1, pushed: true, db: { pulled: true, pushed: true } });
    expect(db.get<{ triage_why: string; user_state: string }>("SELECT triage_why, user_state FROM entity WHERE id = 'github:lifehub/planner'")).toEqual({ triage_why: "cloud", user_state: "kept" });
    expect(docs.docs.get("owners/owner/snapshot/latest")!.payload).toContain("github:lifehub/planner");
  });
});
