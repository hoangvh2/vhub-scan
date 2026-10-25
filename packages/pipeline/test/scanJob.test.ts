import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DB_OBJECT, pullDb, pushDb } from "../src/cloud/dbsync.js";
import { requestOf } from "../src/cloud/function.js";
import { runCloudScan, scanDay, type ScanJobDeps } from "../src/cloud/scanJob.js";
import { githubSettings } from "../src/config.js";
import { FakeLlm } from "../src/llm/fake.js";
import { runPipeline } from "../src/pipeline.js";
import { GitHubSource } from "../src/sources/github.js";
import { HackerNewsSource } from "../src/sources/hackernews.js";
import { NOW, rig, TestClock } from "./helpers.js";
import { MemoryBlobs, MemoryDocs } from "./memory.js";
import { cfg, world } from "./world.js";

const TODAY = scanDay(NOW.getTime());
const REQ = `owners/owner/runRequests/${TODAY}-1`;

/** A PC that has scanned once and shared its database and config, and a phone that pressed the button. */
async function setup(o: { requestId?: string; shared?: boolean } = {}) {
  const pc = rig({ cfg: cfg(), ...world() });
  await runPipeline(pc.deps);
  const blobs = new MemoryBlobs();
  if (o.shared !== false) await pushDb(pc.db, blobs, JSON.stringify({ sources: { hn: { enabled: false } } }));
  const docs = new MemoryDocs();
  const requestId = o.requestId ?? `${TODAY}-1`;
  docs.docs.set(`owners/owner/runRequests/${requestId}`, { at: NOW.getTime(), device: "Pixel 8" });
  const w = world();
  const fake = new FakeLlm();
  const deps: ScanJobDeps = {
    docs, blobs, uid: "owner", requestId, clock: new TestClock(new Date(NOW.getTime() + 3_600_000)), perDay: 2, model: "gemini-3.5-flash-lite",
    adapter: () => fake,
    sources: (c) => ({
      github: new GitHubSource({ cfg: githubSettings(c), fetchImpl: w.fetchImpl, sleep: async () => undefined }),
      hn: (last) => new HackerNewsSource({ cfg: c.sources.hn, fetchImpl: w.hnFetch, sleep: async () => undefined, lastMaxId: last }),
    }),
    workDir: mkdtempSync(join(tmpdir(), "scan-")),
  };
  return { pc, blobs, docs, deps, fake, w };
}

describe("cloud scan", () => {
  it("scans the shared database with the cloud model, uploads it back, publishes the snapshot and reports on the request", async () => {
    const { pc, blobs, docs, deps, fake } = await setup();
    const gen0 = blobs.objects.get(DB_OBJECT)!.generation;
    // A phone action waiting for the PC: the cloud applies it and removes it from the inbox once the result is saved.
    docs.docs.set("owners/owner/inbox/evt_0123456789", { entityId: "github:acme/taskflow", action: "keep", at: NOW.getTime() + 60_000 });

    const r = await runCloudScan(deps);
    expect(r.status).toBe("done");
    const req = docs.docs.get(REQ)!;
    expect(req).toMatchObject({ status: "done", model: "gemini-3.5-flash-lite", at: NOW.getTime(), device: "Pixel 8" });
    expect(typeof req.startedAt).toBe("string");
    expect(typeof req.tokens).toBe("number");
    expect(blobs.objects.get(DB_OBJECT)!.generation).not.toBe(gen0);
    expect(docs.docs.has("owners/owner/inbox/evt_0123456789")).toBe(false);
    expect(docs.docs.get("owners/owner/snapshot/latest")?.payload).toBeTruthy();
    // Requests reached the model under the cloud model's name.
    expect(fake.calls.every((c) => c.model === "gemini-3.5-flash-lite")).toBe(true);

    // The PC takes the result on its next sync, including the phone action.
    expect((await pullDb(pc.db, blobs)).pulled).toBe(true);
    expect(pc.db.get<{ user_state: string }>("SELECT user_state FROM entity WHERE id = 'github:acme/taskflow'")!.user_state).toBe("kept");
    expect(pc.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM run")!.n).toBe(2);
  });

  it("runs once per request, even when the event is delivered twice", async () => {
    const { deps, blobs } = await setup();
    expect((await runCloudScan(deps)).status).toBe("done");
    const gen = blobs.objects.get(DB_OBJECT)!.generation;
    expect((await runCloudScan(deps)).status).toBe("duplicate");
    expect(blobs.objects.get(DB_OBJECT)!.generation).toBe(gen);
  });

  it("refuses requests beyond the daily limit or for another day, without scanning", async () => {
    for (const id of [`${TODAY}-3`, `${TODAY - 1}-1`, "anything"]) {
      const { deps, docs, fake } = await setup({ requestId: id });
      expect((await runCloudScan(deps)).status).toBe("refused");
      expect(docs.docs.get(`owners/owner/runRequests/${id}`)!.status).toBe("refused");
      expect(fake.calls).toHaveLength(0);
    }
  });

  it("fails with a clear message when the PC has not shared its database yet", async () => {
    const { deps, docs } = await setup({ shared: false });
    expect((await runCloudScan(deps)).status).toBe("failed");
    expect(String(docs.docs.get(REQ)!.message)).toMatch(/npm run sync/);
  });

  it("drops its result, and keeps the phone actions in the inbox, when the PC uploaded during the scan", async () => {
    const { deps, docs, blobs, pc } = await setup();
    docs.docs.set("owners/owner/inbox/evt_0123456789", { entityId: "github:acme/taskflow", action: "keep", at: NOW.getTime() });
    const sources = deps.sources;
    deps.sources = (c) => {
      // The PC changes something and uploads while the cloud is busy.
      pc.store.applyFeedback("github:lifehub/planner", "skip", NOW);
      void pushDb(pc.db, blobs, null);
      return sources(c);
    };
    const r = await runCloudScan(deps);
    expect(r.status).toBe("failed");
    expect(r.message).toMatch(/PC vừa cập nhật/);
    expect(docs.docs.has("owners/owner/inbox/evt_0123456789")).toBe(true);
    expect(docs.docs.has("owners/owner/snapshot/latest")).toBe(false);
  });

  it("removes requests older than two weeks", async () => {
    const { deps, docs } = await setup();
    docs.docs.set(`owners/owner/runRequests/${TODAY - 15}-1`, { at: 1, status: "done" });
    docs.docs.set(`owners/owner/runRequests/${TODAY - 3}-2`, { at: 1, status: "done" });
    await runCloudScan(deps);
    expect(docs.docs.has(`owners/owner/runRequests/${TODAY - 15}-1`)).toBe(false);
    expect(docs.docs.has(`owners/owner/runRequests/${TODAY - 3}-2`)).toBe(true);
  });

  it("day numbers follow Vietnam time", () => {
    // 16:59 UTC is still the same day in Vietnam (23:59); 17:00 UTC is the next one.
    expect(scanDay(Date.parse("2026-10-25T16:59:59Z"))).toBe(scanDay(Date.parse("2026-10-25T00:00:00Z")));
    expect(scanDay(Date.parse("2026-10-25T17:00:00Z"))).toBe(scanDay(Date.parse("2026-10-25T00:00:00Z")) + 1);
  });

  it("only acts on run requests of its own owner folder", () => {
    expect(requestOf({ document: "owners/owner/runRequests/20386-1" }, "owner")).toBe("20386-1");
    expect(requestOf({ subject: "documents/owners/owner/runRequests/20386-2" }, "owner")).toBe("20386-2");
    expect(requestOf({ document: "owners/other/runRequests/20386-1" }, "owner")).toBeNull();
    expect(requestOf({ document: "owners/owner/inbox/20386-1" }, "owner")).toBeNull();
    expect(requestOf({}, "owner")).toBeNull();
  });
});
