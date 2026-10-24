import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ClaudeCliAdapter } from "../src/llm/claudeCli.js";
import { LlmError, type LlmRequest } from "../src/llm/types.js";

const script = new URL("./fake-claude.mjs", import.meta.url).pathname;
const req: LlmRequest = {
  system: "Reply with JSON only.",
  user: "line one\nline two",
  schema: { type: "object" },
  model: "haiku",
  stage: "triage",
  promptVersion: "t1",
  expectedOutTokens: 10,
};

function adapter(mode: string, timeoutMs = 10_000) {
  const dir = mkdtempSync(join(tmpdir(), "fc-"));
  const log = join(dir, "log.jsonl");
  process.env.FAKE_CLAUDE_MODE = mode;
  process.env.FAKE_CLAUDE_LOG = log;
  return { a: new ClaudeCliAdapter({ command: process.execPath, prefixArgs: [script], timeoutMs, cwd: join(dir, "cwd") }), log };
}

describe("ClaudeCliAdapter", () => {
  it("passes the prompt on stdin with every extra feature switched off, and maps usage", async () => {
    const { a, log } = adapter("ok");
    const res = await a.call(req);
    expect(res.data).toEqual({ items: [{ id: "a", s: 3 }] });
    expect(res.usage).toEqual({ inTokens: 1902, outTokens: 70, costUsd: 0.0007 });
    const seen = JSON.parse(readFileSync(log, "utf8").trim()) as { args: string[]; stdin: string; cwd: string };
    expect(seen.stdin).toBe("line one\nline two");
    for (const flag of ["-p", "--no-session-persistence", "--disable-slash-commands", "--strict-mcp-config", "--exclude-dynamic-system-prompt-sections"]) {
      expect(seen.args).toContain(flag);
    }
    expect(seen.args[seen.args.indexOf("--tools") + 1]).toBe("");
    expect(seen.args[seen.args.indexOf("--model") + 1]).toBe("haiku");
    expect(seen.args[seen.args.indexOf("--output-format") + 1]).toBe("json");
    expect(seen.args[seen.args.indexOf("--system-prompt") + 1]).toBe("Reply with JSON only.");
    expect(seen.args).not.toContain("--effort");
    expect(seen.cwd).toContain("cwd"); // an empty directory, so no project CLAUDE.md is picked up
  });
  it("passes the effort level when one is set", async () => {
    const { a, log } = adapter("ok");
    await a.call({ ...req, effort: "low" });
    const seen = JSON.parse(readFileSync(log, "utf8").trim()) as { args: string[] };
    expect(seen.args[seen.args.indexOf("--effort") + 1]).toBe("low");
  });
  it("falls back to parsing the text result", async () => {
    const res = await adapter("text-result").a.call(req);
    expect(res.data).toEqual({ items: [{ id: "a", s: 2 }] });
  });
  it("reports CLI errors as retryable", async () => {
    await expect(adapter("error").a.call(req)).rejects.toMatchObject({ name: "LlmError", retryable: true });
  });
  it("reports non-JSON output", async () => {
    await expect(adapter("garbage").a.call(req)).rejects.toBeInstanceOf(LlmError);
  });
  it("kills a call that takes too long", async () => {
    await expect(adapter("slow", 300).a.call(req)).rejects.toThrow(/timed out/);
  });
  it("says so when the binary is missing", async () => {
    const a = new ClaudeCliAdapter({ command: "definitely-not-claude-xyz", timeoutMs: 2000, cwd: join(tmpdir(), "fc-missing") });
    await expect(a.call(req)).rejects.toThrow(/cannot run/);
  });
});
