#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDeps, ensureToken, loadHomeConfig, resolveHome } from "./app.js";
import { ClaudeCliAdapter } from "./llm/claudeCli.js";
import { USER_ACTIONS, systemClock, type UserAction } from "./model.js";
import { runPipeline } from "./pipeline.js";
import { createApp } from "./server.js";

const here = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv: string[]): { cmd: string; pos: string[]; flags: Map<string, string | true> } {
  const [cmd = "help", ...rest] = argv;
  const flags = new Map<string, string | true>();
  const pos: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a.startsWith("--")) {
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags.set(a.slice(2), next);
        i++;
      } else flags.set(a.slice(2), true);
    } else pos.push(a);
  }
  return { cmd, pos, flags };
}

const HELP = `trend: personal idea scanner (PC-first)

  trend init [--home DIR]           create the data folder, a config and an access token
  trend doctor [--llm]              check Node, Claude CLI, GitHub token; --llm makes one tiny real call
  trend run                         collect, filter, analyse, build today's digest
  trend serve [--lan] [--port N]    local dashboard + API (loopback only unless --lan)
  trend feedback <id> <action>      ${USER_ACTIONS.join(" | ")}
  trend status                      last run and today's token use
  trend schedule                    print how to run it every day on this OS

Data lives in --home, or $VHUB_TREND_HOME, or ~/.vhub-trend. Set GITHUB_TOKEN for a higher GitHub rate limit.`;

async function main(): Promise<number> {
  const { cmd, pos, flags } = parseArgs(process.argv.slice(2));
  const home = resolveHome(typeof flags.get("home") === "string" ? (flags.get("home") as string) : undefined);

  switch (cmd) {
    case "init": {
      mkdirSync(home.dir, { recursive: true });
      if (!existsSync(home.configFile)) copyFileSync(join(here, "..", "config.example.json"), home.configFile);
      ensureToken(home);
      console.log(`Ready: ${home.dir}\nEdit ${home.configFile} (topics, seeds, your projects), then run: trend doctor`);
      return 0;
    }
    case "doctor": {
      const cfg = loadHomeConfig(home);
      const major = Number(process.versions.node.split(".")[0]);
      const minor = Number(process.versions.node.split(".")[1]);
      const nodeOk = major > 22 || (major === 22 && minor >= 13);
      console.log(`${nodeOk ? "ok  " : "FAIL"} Node ${process.versions.node} (needs >= 22.13)`);
      console.log(`${process.env.GITHUB_TOKEN ? "ok  " : "warn"} GITHUB_TOKEN ${process.env.GITHUB_TOKEN ? "set" : "not set: GitHub allows only 60 requests/hour and 10 searches/minute without it"}`);
      console.log(`${existsSync(home.configFile) ? "ok  " : "warn"} config ${existsSync(home.configFile) ? home.configFile : "missing, defaults in use (run trend init)"}`);
      if (cfg.llm.kind === "claude-cli" && flags.get("llm")) {
        const a = new ClaudeCliAdapter({ command: cfg.llm.command, timeoutMs: 30_000 });
        try {
          const r = await a.call({
            system: "Reply with JSON only.",
            user: "Return {\"ok\":true}",
            schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
            model: cfg.llm.triageModel,
            stage: "triage",
            promptVersion: "doctor",
            expectedOutTokens: 20,
            effort: cfg.llm.triageEffort,
          });
          console.log(`ok   Claude CLI answered (${r.usage.inTokens} in / ${r.usage.outTokens} out tokens, fixed overhead included)`);
        } catch (e) {
          console.log(`FAIL Claude CLI: ${e instanceof Error ? e.message : e}`);
          return 1;
        }
      }
      return nodeOk ? 0 : 1;
    }
    case "run": {
      const cfg = loadHomeConfig(home);
      const { deps, db } = buildDeps(home, cfg);
      try {
        const st = await runPipeline(deps);
        console.log(JSON.stringify(st, null, 2));
        return st.sourceErrors.length || st.degraded.length ? 2 : 0;
      } finally {
        db.close();
      }
    }
    case "serve": {
      const cfg = loadHomeConfig(home);
      const { deps, store, db, budget } = buildDeps(home, cfg);
      const token = ensureToken(home);
      let running = false;
      const port = Number(flags.get("port") ?? cfg.server.port);
      const host = flags.get("lan") ? "0.0.0.0" : "127.0.0.1";
      const app = createApp({
        db, store, budget, token,
        runNow: async () => {
          if (running) return { started: false, reason: "already running" };
          running = true;
          void runPipeline(deps).catch(() => undefined).finally(() => (running = false));
          return { started: true };
        },
      });
      await new Promise<void>((r) => app.listen(port, host, r));
      console.log(`Dashboard: http://${host === "0.0.0.0" ? "<this PC's LAN address>" : "localhost"}:${port}/?t=${token}`);
      if (host === "0.0.0.0") console.log("LAN mode: anyone on your network with this link can read and change your list. Keep the token private.");
      return await new Promise<number>(() => undefined);
    }
    case "feedback": {
      const [id, action] = pos;
      if (!id || !(USER_ACTIONS as readonly string[]).includes(action ?? "")) {
        console.error(`usage: trend feedback <id> <${USER_ACTIONS.join("|")}>`);
        return 1;
      }
      const { store, db } = buildDeps(home, loadHomeConfig(home));
      const ok = store.applyFeedback(id, action as UserAction, systemClock.now());
      db.close();
      console.log(ok ? "ok" : "no such id");
      return ok ? 0 : 1;
    }
    case "status": {
      const cfg = loadHomeConfig(home);
      const { db, budget } = buildDeps(home, cfg);
      const run = db.get<{ started_at: string; status: string; stats: string }>("SELECT started_at, status, stats FROM run ORDER BY started_at DESC LIMIT 1");
      console.log(run ? `last run ${run.started_at} ${run.status}\n${run.stats}` : "no runs yet");
      console.log("tokens today", JSON.stringify(budget.today(systemClock.now())));
      db.close();
      return 0;
    }
    case "schedule": {
      const node = process.execPath;
      const cli = join(here, "cli.js");
      writeFileSync(1, `# Run once a day at 07:00, and catch up if the PC was off.

## Windows (PowerShell). Not yet verified on a real Windows PC.
$a = New-ScheduledTaskAction -Execute "${node}" -Argument '"${cli}" run'
$t = New-ScheduledTaskTrigger -Daily -At 7:00am
$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName "VHub Trend Scan" -Action $a -Trigger $t -Settings $s

## Linux / macOS (cron). Catch-up after the PC was off needs anacron or a systemd timer with Persistent=true.
0 7 * * * GITHUB_TOKEN=... ${node} ${cli} run >> ~/.vhub-trend/run.log 2>&1
`);
      return 0;
    }
    default:
      console.log(HELP);
      return cmd === "help" ? 0 : 1;
  }
}

main().then(
  (c) => process.exit(c),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
