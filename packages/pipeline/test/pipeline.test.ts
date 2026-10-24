import { describe, expect, it } from "vitest";
import { Db } from "../src/db.js";
import { FakeLlm } from "../src/llm/fake.js";
import { runPipeline, STAGES, type StageName } from "../src/pipeline.js";
import { fakeFetch, NOW, rig, TestClock } from "./helpers.js";
import { cfg, world } from "./world.js";

describe("pipeline end to end", () => {
  it("narrows raw items to a small digest and spends few LLM calls", async () => {
    const w = world();
    const r = rig({ cfg: cfg(), ...w });
    const st = await runPipeline(r.deps);

    expect(st.collected).toBe(9); // 6 search results + 2 HN items + the GitHub repo that HN item 101 resolves to
    expect(st.merged).toBe(1); // mirror/taskflow folded into acme/taskflow
    expect(st.dropped).toMatchObject({ out_of_scope: 1, thin: 1, old: 1 });
    expect(st.triaged).toBe(3);
    expect(st.carded).toBeGreaterThan(0);
    expect(st.llmCalls).toBe(2); // one triage batch, one card batch
    expect(st.sourceErrors).toEqual([]);

    const ids = r.db.all<{ entity_id: string }>("SELECT entity_id FROM digest ORDER BY rank").map((x) => x.entity_id);
    expect(ids).toContain("github:acme/taskflow");
    expect(ids).not.toContain("github:acme/video-studio");
    // The HN post about the same repo is one entity with two sources, not two digest items.
    expect([...new Set(r.store.sightings("github:acme/taskflow").map((s) => s.source))].sort()).toEqual(["github", "hn"]);
    expect(r.store.sightings("github:acme/taskflow")).toHaveLength(3); // the repo, its mirror, and the Show HN post
    expect(r.store.entity("github:acme/taskflow")!.title).toBe("acme/taskflow"); // neither copy rewrote the text
    expect(r.store.entity("github:acme/taskflow")!.body).toContain("Plan your week");
  });

  it("a re-run the same day makes no LLM calls and changes nothing", async () => {
    const w = world();
    const r = rig({ cfg: cfg(), ...w });
    await runPipeline(r.deps);
    const before = JSON.stringify(r.store.snapshot());
    const second = await runPipeline(r.deps);
    expect(second.llmCalls).toBe(0);
    expect(JSON.stringify(r.store.snapshot())).toBe(before);
  });

  it("next day: already shown items are not repeated and Skip is remembered", async () => {
    const w = world();
    const r = rig({ cfg: cfg(), ...w });
    await runPipeline(r.deps);
    const day1 = r.db.all<{ entity_id: string }>("SELECT entity_id FROM digest WHERE day = '2026-10-24'").map((x) => x.entity_id);
    r.store.applyFeedback(day1[0]!, "skip", r.clock.now());
    r.clock.advanceDays(1);
    await runPipeline(r.deps);
    const day2 = r.db.all<{ entity_id: string }>("SELECT entity_id FROM digest WHERE day = '2026-10-25'").map((x) => x.entity_id);
    for (const id of day1) expect(day2).not.toContain(id);
    expect(r.store.entity(day1[0]!)!.user_state).toBe("skipped");
  });

  it("stops LLM work when the daily budget is spent, but still produces a digest", async () => {
    const c = cfg();
    c.budget.dailyTokens = 100;
    const r = rig({ cfg: c, ...world() });
    const st = await runPipeline(r.deps);
    expect(st.llmCalls).toBe(0);
    expect(st.degraded).toContain("triage:budget");
    expect(st.digest).toBeGreaterThan(0);
    expect(r.db.get<{ reason: string }>("SELECT reason FROM digest LIMIT 1")!.reason).toBe("chưa phân tích bằng AI");
  });

  it("survives a failing source: the others still run and the error is reported", async () => {
    const w = world();
    const failing = fakeFetch(() => ({ status: 403, headers: { "x-ratelimit-remaining": "0" } }));
    const r = rig({ cfg: cfg(), fetchImpl: failing, hnFetch: w.hnFetch });
    const st = await runPipeline(r.deps);
    expect(st.sourceErrors[0]).toMatch(/github: github: rate limit/);
    expect(st.collected).toBeGreaterThan(0);
  });

  it("adaptive refresh only polls entities that matter, at most every 2 days", async () => {
    const w = world();
    const r = rig({ cfg: cfg(), ...w });
    await runPipeline(r.deps);
    const polled = (n: string) => w.requests.filter((x) => x === `/repos/${n}`).length;
    const first = polled("lifehub/planner");
    await runPipeline(r.deps); // same day: nothing to refresh
    expect(polled("lifehub/planner")).toBe(first);
    // Day 4: the search no longer lists it, so only the refresh stage can bring fresh numbers.
    w.search.splice(0, w.search.length, ...w.search.filter((x) => x.full_name !== "lifehub/planner"));
    r.clock.advanceDays(3);
    await runPipeline(r.deps);
    expect(polled("lifehub/planner")).toBe(first + 1);
    expect(polled("acme/video-studio")).toBe(0); // dropped items are never polled
    expect(r.store.observations("github:lifehub/planner")).toHaveLength(2);
  });
});

describe("checkpoint and resume", () => {
  const clean = async () => {
    const r = rig({ cfg: cfg(), ...world() });
    await runPipeline(r.deps);
    return { snap: JSON.stringify(r.store.snapshot()), calls: r.fake.calls.length };
  };

  for (const stage of STAGES) {
    it(`a crash after "${stage}" resumes to the identical result with no repeated LLM calls`, async () => {
      const reference = await clean();
      const db = new Db(":memory:");
      const fake = new FakeLlm();
      const clock = new TestClock(NOW);
      const crash = rig({ cfg: cfg(), ...world(), db, fake, clock });
      crash.deps.afterStage = (s: StageName) => {
        if (s === stage) throw new Error(`boom after ${s}`);
      };
      await expect(runPipeline(crash.deps)).rejects.toThrow(/boom/);
      expect(db.get<{ status: string }>("SELECT status FROM run ORDER BY started_at DESC LIMIT 1")!.status).toBe("failed");

      const resumed = rig({ cfg: cfg(), ...world(), db, fake, clock }); // a fresh process: new Store, same database
      await runPipeline(resumed.deps);
      expect(JSON.stringify(resumed.store.snapshot())).toBe(reference.snap);
      expect(fake.calls.length).toBe(reference.calls);
    });
  }

  it("a killed process (run left 'running') is resumed by the next run, but a live one blocks", async () => {
    const r = rig({ cfg: cfg(), ...world() });
    r.db.run("INSERT INTO run (id, started_at, status, heartbeat, pid) VALUES ('dead', ?, 'running', ?, 99999999)", NOW.toISOString(), NOW.toISOString());
    await expect(runPipeline(r.deps)).resolves.toBeTruthy();
    expect(r.db.get<{ status: string }>("SELECT status FROM run WHERE id = 'dead'")!.status).toBe("interrupted");

    r.db.run("INSERT INTO run (id, started_at, status, heartbeat, pid) VALUES ('live', ?, 'running', ?, ?)", NOW.toISOString(), NOW.toISOString(), process.pid);
    await expect(runPipeline(r.deps)).rejects.toThrow(/another run is active/);
  });
});
