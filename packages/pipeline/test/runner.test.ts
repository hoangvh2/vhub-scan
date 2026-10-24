import { describe, expect, it } from "vitest";
import { Budget } from "../src/llm/budget.js";
import { FakeLlm } from "../src/llm/fake.js";
import { LlmRunner } from "../src/llm/runner.js";
import type { LlmRequest } from "../src/llm/types.js";
import { Db } from "../src/db.js";
import { NOW } from "./helpers.js";

const req = (user: string): LlmRequest => ({
  system: "s",
  user,
  schema: {},
  model: "haiku",
  stage: "triage",
  promptVersion: "v1",
  expectedOutTokens: 50,
});

function setup(limit = 50_000) {
  const db = new Db(":memory:");
  const fake = new FakeLlm();
  const budget = new Budget(db, limit);
  return { db, fake, budget, runner: new LlmRunner(fake, db, budget, async () => undefined) };
}

describe("LlmRunner", () => {
  it("serves an identical request from the cache without calling the model", async () => {
    const { runner, fake } = setup();
    const a = await runner.call(req("x|tool|a tool"), NOW);
    const b = await runner.call(req("x|tool|a tool"), NOW);
    expect(a).toMatchObject({ kind: "ok", cached: false });
    expect(b).toMatchObject({ kind: "ok", cached: true });
    expect(fake.calls).toHaveLength(1);
  });
  it("a new prompt version is a new question", async () => {
    const { runner, fake } = setup();
    await runner.call(req("x|tool|a tool"), NOW);
    await runner.call({ ...req("x|tool|a tool"), promptVersion: "v2" }, NOW);
    expect(fake.calls).toHaveLength(2);
  });
  it("stops at the daily budget and says so", async () => {
    const { runner, fake, budget } = setup(6_000);
    const first = await runner.call(req("a|tool|x"), NOW);
    expect(first.kind).toBe("ok");
    expect(budget.remaining(NOW)).toBeLessThan(3_000);
    const second = await runner.call(req("b|tool|y"), NOW);
    expect(second).toEqual({ kind: "skipped", reason: "budget" });
    expect(fake.calls).toHaveLength(1);
  });
  it("retries a transient error, then gives up without throwing", async () => {
    const { runner, fake } = setup();
    fake.failNext = 1;
    expect((await runner.call(req("a|tool|x"), NOW)).kind).toBe("ok");
    expect(fake.calls).toHaveLength(2);
    fake.failNext = 10;
    const r = await runner.call(req("b|tool|y"), NOW);
    expect(r).toMatchObject({ kind: "skipped", reason: "error" });
  });
  it("records tokens per day", async () => {
    const { runner, budget } = setup();
    await runner.call(req("a|tool|x"), NOW);
    const t = budget.today(NOW);
    expect(t.calls).toBe(1);
    expect(t.inTokens).toBeGreaterThan(3_700);
  });
});
