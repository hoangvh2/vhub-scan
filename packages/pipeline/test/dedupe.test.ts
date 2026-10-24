import { describe, expect, it } from "vitest";
import { rig, item, NOW } from "./helpers.js";

const D1 = "A command line assistant that plans your week, tracks habits and automates repetitive daily workflow tasks";

describe("near-duplicate detection (labelled mini set)", () => {
  const cases: { name: string; a: Parameters<typeof item>[0]; b: Parameters<typeof item>[0]; merge: boolean }[] = [
    { name: "same text cross-posted under another URL", a: { sourceId: "acme/taskflow", description: D1 }, b: { source: "hn", sourceId: "1", url: "https://taskflow.example.com", title: "taskflow", description: D1 }, merge: true },
    { name: "same text, small edit", a: { sourceId: "acme/taskflow", description: D1 }, b: { source: "hn", sourceId: "2", url: "https://t.example.com", title: "taskflow", description: D1 + " today" }, merge: true },
    { name: "mirror repo with same text", a: { sourceId: "acme/taskflow", description: D1 }, b: { sourceId: "mirror/taskflow", description: D1 }, merge: true },
    { name: "same author, siblings with different text", a: { sourceId: "acme/habit-ios", description: "An iOS app that tracks daily habits with widgets and gentle reminders for busy people" }, b: { sourceId: "acme/habit-android", description: "Android client for the same service with offline sync and material design components" }, merge: false },
    { name: "same words in the title but different projects", a: { sourceId: "a/notes-cli", description: "Terminal note taking tool with tags and full text search over markdown files in a folder" }, b: { sourceId: "b/notes-sync", description: "Self hosted service that syncs encrypted notes between phones using webdav and conflict free merges" }, merge: false },
    { name: "unrelated", a: { sourceId: "a/planner", description: D1 }, b: { sourceId: "b/raytrace", description: "Real time ray tracing renderer with vulkan backend and physically based materials" }, merge: false },
  ];

  for (const c of cases) {
    it(`${c.merge ? "merges" : "keeps apart"}: ${c.name}`, () => {
      const r = rig();
      r.store.upsertItem(item(c.a), NOW);
      const res = r.store.upsertItem(item(c.b), NOW);
      expect(Boolean(res.mergedInto)).toBe(c.merge);
    });
  }

  it("known limitation: a paraphrase is not merged by the cheap layer", () => {
    const r = rig();
    r.store.upsertItem(item({ sourceId: "acme/taskflow", description: D1 }), NOW);
    const res = r.store.upsertItem(
      item({ source: "hn", sourceId: "3", url: "https://x.example.com", title: "TaskFlow", description: "Plan the week from your terminal, keep habit streaks, and script away the boring chores" }),
      NOW,
    );
    expect(res.mergedInto).toBeUndefined();
  });

  it("one entity for the same canonical key, and an alias remembers the merge", () => {
    const r = rig();
    const a = r.store.upsertItem(item({ sourceId: "acme/taskflow", description: D1 }), NOW);
    r.store.upsertItem(item({ source: "hn", sourceId: "9", url: "https://github.com/Acme/TaskFlow?utm_source=hn", title: "TaskFlow", description: "Show" }), NOW);
    expect(r.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM entity")!.n).toBe(1);
    expect(r.store.sightings(a.id).map((s) => s.source).sort()).toEqual(["github", "hn"]);
    const m = r.store.upsertItem(item({ sourceId: "mirror/taskflow", description: D1 }), NOW);
    const again = r.store.upsertItem(item({ sourceId: "mirror/taskflow", description: D1 }), NOW);
    expect(again.id).toBe(m.id);
    expect(again.created).toBe(false);
  });
});
