import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LlmError, type LlmAdapter, type LlmRequest, type LlmResponse } from "./types.js";

export interface ClaudeCliOptions {
  command: string;
  /** Arguments placed before ours (tests use it to run a fake script through `node`). */
  prefixArgs?: string[];
  timeoutMs: number;
  /** Empty directory so no project CLAUDE.md, hooks or settings are loaded. */
  cwd?: string;
}

interface CliResult {
  is_error?: boolean;
  subtype?: string;
  result?: string;
  structured_output?: unknown;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens?: number;
  };
}

/**
 * Runs `claude -p` once per call with every extra feature switched off (no tools, no session file, no slash
 * commands, no MCP, no user settings) so the only prompt overhead left is the fixed base prompt. The user text
 * goes in on stdin (no command-line length limit). Uses the user's own Claude login: no API key is handled here.
 */
export class ClaudeCliAdapter implements LlmAdapter {
  readonly name = "claude-cli";
  private readonly cwd: string;

  constructor(private readonly opt: ClaudeCliOptions) {
    this.cwd = opt.cwd ?? join(tmpdir(), "vhub-trend-claude");
    mkdirSync(this.cwd, { recursive: true });
  }

  call(req: LlmRequest): Promise<LlmResponse> {
    const args = [
      ...(this.opt.prefixArgs ?? []),
      "-p",
      "--output-format", "json",
      "--json-schema", JSON.stringify(req.schema),
      "--model", req.model,
      "--tools", "",
      "--no-session-persistence",
      "--disable-slash-commands",
      "--strict-mcp-config",
      "--setting-sources", "",
      "--exclude-dynamic-system-prompt-sections",
      ...(req.effort ? ["--effort", req.effort] : []),
      "--system-prompt", req.system,
    ];
    return new Promise((resolve, reject) => {
      const child = spawn(this.opt.command, args, { cwd: this.cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      let out = "";
      let err = "";
      let done = false;
      const finish = (fn: () => void) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        fn();
      };
      const timer = setTimeout(() => {
        child.kill();
        finish(() => reject(new LlmError("claude timed out", true)));
      }, this.opt.timeoutMs);
      child.stdout.setEncoding("utf8").on("data", (d: string) => (out += d));
      child.stderr.setEncoding("utf8").on("data", (d: string) => (err += d));
      child.on("error", (e) => finish(() => reject(new LlmError(`cannot run "${this.opt.command}": ${e.message}`, false))));
      child.on("close", (code) =>
        finish(() => {
          try {
            resolve(parseCliOutput(out, code, err));
          } catch (e) {
            reject(e);
          }
        }),
      );
      child.stdin.on("error", () => undefined);
      child.stdin.end(req.user);
    });
  }
}

export function parseCliOutput(stdout: string, code: number | null, stderr: string): LlmResponse {
  let r: CliResult;
  try {
    r = JSON.parse(stdout) as CliResult;
  } catch {
    throw new LlmError(`claude exited ${code} without JSON: ${(stderr || stdout).slice(0, 200)}`, code !== 0);
  }
  if (r.is_error) throw new LlmError(`claude error: ${String(r.result ?? r.subtype ?? "unknown").slice(0, 200)}`, true);
  let data: unknown = r.structured_output;
  if (data === undefined && typeof r.result === "string") {
    try {
      data = JSON.parse(r.result);
    } catch {
      throw new LlmError("claude returned text that is not JSON", true);
    }
  }
  if (data === undefined) throw new LlmError("claude returned no structured output", true);
  const u = r.usage ?? {};
  return {
    data,
    usage: {
      inTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      outTokens: u.output_tokens ?? 0,
      costUsd: r.total_cost_usd ?? 0,
    },
  };
}
