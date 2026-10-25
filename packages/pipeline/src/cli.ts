#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCloud, buildDeps, ensureToken, loadHomeConfig, resolveHome, settingsStore, type Cloud } from "./app.js";
import { fromTerraformOutput, writeCloudConfig } from "./cloud/config.js";
import { lastRemoteSettings, lastSync } from "./cloud/sync.js";
import { defaultConfig, githubSettings, type Config } from "./config.js";
import { ClaudeCliAdapter } from "./llm/claudeCli.js";
import { USER_ACTIONS, systemClock, type UserAction } from "./model.js";
import { runPipeline } from "./pipeline.js";
import { createApp } from "./server.js";
import { GitHubSource } from "./sources/github.js";
import { checkConfig, checkGithubToken, initGuide, probeCommand, runSummary } from "./setup.js";

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

const HELP = `VHub Trend Scan: quét ý tưởng công cụ đáng làm, chạy trên PC

Lần đầu, chạy theo thứ tự (trong thư mục repo):
  npm ci                  cài thư viện
  npm run setup           build + tạo ~/.vhub-trend/config.json, rồi in hướng dẫn sửa config
  npm run doctor          kiểm tra config, GITHUB_TOKEN, Claude CLI; báo đúng chỗ cần sửa
  npm run scan            quét và phân tích (một lần chạy đầy đủ)
  npm run dashboard       mở dashboard trên máy này

Hằng ngày:
  npm run scan            hoặc đặt lịch tự chạy: npm run schedule
  npm run status          lần chạy gần nhất, token đã dùng hôm nay

Điện thoại và web (đăng nhập Google, xem infra/README.md):
  npm run sync                  đẩy dữ liệu mới lên cloud và nhận thao tác từ web/điện thoại
  npm run web:deploy            đưa dashboard web lên Firebase Hosting

Lệnh đầy đủ (npm run trend -- <lệnh>, hoặc node packages/pipeline/dist/cli.js <lệnh>):
  init [--home DIR]           tạo thư mục dữ liệu, config, token; in hướng dẫn
  doctor [--llm]              kiểm tra; --llm gọi thử Claude một lần rất nhỏ
  run [--json]                thu thập, lọc, phân tích, làm digest hôm nay; --json in số liệu thô
  serve [--lan] [--port N]    dashboard + API (chỉ máy này, trừ khi có --lan)
  feedback <id> <action>      ${USER_ACTIONS.join(" | ")}
  status                      lần chạy gần nhất và token hôm nay
  schedule                    in lệnh đặt lịch chạy hằng ngày cho hệ điều hành này

Điện thoại và cloud (không bắt buộc; xem infra/README.md):
  cloud connect [--infra DIR] đọc output Terraform, ghi ~/.vhub-trend/cloud.json, kiểm tra kết nối
  sync                        đồng bộ ngay: nhận thao tác từ web/điện thoại, đẩy dữ liệu mới lên

Dữ liệu nằm ở --home, hoặc $VHUB_TREND_HOME, hoặc ~/.vhub-trend.`;

async function main(): Promise<number> {
  const { cmd, pos, flags } = parseArgs(process.argv.slice(2));
  const home = resolveHome(typeof flags.get("home") === "string" ? (flags.get("home") as string) : undefined);

  switch (cmd) {
    case "init": {
      mkdirSync(home.dir, { recursive: true });
      const created = !existsSync(home.configFile);
      if (created) copyFileSync(join(here, "..", "config.example.json"), home.configFile);
      ensureToken(home);
      console.log(initGuide(home, created, { os: process.platform, githubToken: !!process.env.GITHUB_TOKEN }));
      return 0;
    }
    case "doctor": {
      const fails: string[] = [];
      const line = (level: "ok" | "warn" | "fail", msg: string, fix?: string) => {
        console.log(`${level === "ok" ? "[ok]      " : level === "warn" ? "[nên sửa] " : "[LỖI]     "}${msg}`);
        if (fix) console.log(`           cách sửa: ${fix}`);
        if (level === "fail") fails.push(msg);
      };
      const major = Number(process.versions.node.split(".")[0]);
      const minor = Number(process.versions.node.split(".")[1]);
      const nodeOk = major > 22 || (major === 22 && minor >= 13);
      line(nodeOk ? "ok" : "fail", `Node ${process.versions.node} (cần >= 22.13)`, nodeOk ? undefined : "cài Node 22 LTS mới nhất từ https://nodejs.org");
      let cfg: Config | null = null;
      if (!existsSync(home.configFile)) {
        line("fail", `chưa có config ${home.configFile}`, "chạy: npm run setup");
      } else {
        try {
          cfg = loadHomeConfig(home);
          const issues = checkConfig(cfg);
          if (!issues.length) line("ok", `config ${home.configFile}`);
          for (const i of issues) line(i.level, `config ${i.field}: ${i.problem}`, `${i.fix} (trong ${home.configFile})`);
        } catch (e) {
          line("fail", `config đọc không được: ${e instanceof Error ? e.message : e}`, "mở file, sửa đúng chỗ báo lỗi. Muốn làm lại từ đầu: xoá file đó rồi chạy npm run setup");
        }
      }
      if (cfg?.sources.github.enabled ?? true) {
        const gh = await checkGithubToken(process.env.GITHUB_TOKEN || undefined);
        line(gh.level, gh.msg, gh.fix);
      }
      const llm = cfg?.llm ?? defaultConfig.llm;
      if (llm.kind === "claude-cli") {
        const probe = probeCommand(llm.command);
        if (!probe.ok) {
          line("fail", `không chạy được Claude CLI "${llm.command}": ${probe.reason}`, "cài Claude Code (https://claude.com/claude-code), gõ  claude  một lần để đăng nhập. Đã cài mà vẫn lỗi: ghi đường dẫn đầy đủ vào llm.command trong config");
        } else if (!flags.get("llm")) {
          line("ok", `Claude CLI ${probe.version} (chưa thử gọi thật; chạy  npm run doctor  để thử)`);
        } else {
          const a = new ClaudeCliAdapter({ command: llm.command, timeoutMs: 60_000 });
          try {
            const r = await a.call({
              system: "Reply with JSON only.",
              user: "Return {\"ok\":true}",
              schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
              model: llm.triageModel,
              stage: "triage",
              promptVersion: "doctor",
              expectedOutTokens: 20,
              effort: llm.triageEffort,
            });
            line("ok", `Claude CLI ${probe.version} trả lời được (${r.usage.inTokens} token vào / ${r.usage.outTokens} ra)`);
          } catch (e) {
            line("fail", `Claude CLI không trả lời: ${e instanceof Error ? e.message : e}`, "gõ  claude  trong terminal, đăng nhập nếu được hỏi, rồi chạy lại npm run doctor");
          }
        }
      }
      if (existsSync(home.cloudFile)) {
        let cloud: Cloud | null = null;
        const { db, store, budget } = buildDeps(home, cfg ?? defaultConfig);
        try {
          cloud = buildCloud(home, { db, store, budget });
        } catch (e) {
          line("fail", `cloud.json: ${e instanceof Error ? e.message : e}`, "chạy lại: npm run cloud:connect");
        }
        if (cloud) {
          const r = await cloud.sync();
          line(r.ok ? "ok" : "fail", r.ok ? `cloud: đồng bộ được với Firestore (project ${cloud.cfg.projectId})` : `cloud: không đồng bộ được: ${r.error}`, r.ok ? undefined : "xem infra/README.md mục Lỗi thường gặp");
          if (r.ok && !cloud.cfg.webClientId) line("warn", "cloud: chưa có web_client_id (Client ID đăng nhập Google), nên chưa dựng được web và APK", "làm bước 7 trong infra/README.md rồi chạy lại: npm run cloud:connect");
        }
        db.close();
      } else {
        line("ok", "cloud: chưa bật (không bắt buộc). Muốn xem trên điện thoại khi ra ngoài: xem infra/README.md");
      }
      console.log("");
      if (fails.length) {
        console.log(`Còn ${fails.length} lỗi phải sửa (dòng [LỖI] ở trên). Sửa xong chạy lại:  npm run doctor`);
        return 1;
      }
      console.log("Sẵn sàng. Bước tiếp theo:  npm run scan   (quét ý tưởng, vài phút)");
      console.log("Sau đó:                    npm run dashboard   (mở link nó in ra trong trình duyệt)");
      return 0;
    }
    case "run": {
      const cfg = loadHomeConfig(home);
      const blocking = checkConfig(cfg).filter((i) => i.level === "fail");
      if (blocking.length) {
        for (const i of blocking) console.error(`[LỖI] config ${i.field}: ${i.problem}. Cách sửa: ${i.fix}`);
        console.error(`Sửa trong ${home.configFile}, rồi chạy:  npm run doctor`);
        return 1;
      }
      let { deps, db, store, budget } = buildDeps(home, cfg);
      try {
        const cloud = buildCloud(home, { db, store, budget, log: (m) => console.log(m) });
        // Settings changed on the phone since the last sync take effect in this run.
        const pulled = cloud ? await cloud.pullSettings().catch((e: unknown) => (console.log(`cloud: chưa lấy được cài đặt từ điện thoại (${e instanceof Error ? e.message : e})`), 0)) : 0;
        if (pulled) ({ deps, store, budget } = buildDeps(home, loadHomeConfig(home), { db }));
        const st = await runPipeline(deps);
        if (flags.get("json")) console.log(JSON.stringify(st, null, 2));
        else console.log(runSummary(st));
        const synced = cloud ? await cloud.sync() : null;
        return st.sourceErrors.length || st.degraded.length || (synced && !synced.ok) ? 2 : 0;
      } finally {
        db.close();
      }
    }
    case "serve": {
      const cfg = loadHomeConfig(home);
      const { store, db, budget } = buildDeps(home, cfg);
      const token = ensureToken(home);
      let running = false;
      const port = Number(flags.get("port") ?? cfg.server.port);
      const host = flags.get("lan") ? "0.0.0.0" : "127.0.0.1";
      const cloud = buildCloud(home, { db, store, budget, log: (m) => console.log(m) });
      let syncing = false;
      const sync = async () => {
        if (!cloud || syncing) return;
        syncing = true;
        await cloud.sync().finally(() => (syncing = false));
      };
      const settings = settingsStore(home);
      const app = createApp({
        db, store, budget, token, settings,
        runNow: async () => {
          if (running) return { started: false, reason: "already running" };
          running = true;
          // Each run reads config.json again, so changes from the settings page apply without restarting the dashboard.
          const run = async () => {
            if (cloud) await cloud.pullSettings().catch(() => 0);
            await runPipeline(buildDeps(home, loadHomeConfig(home), { db }).deps);
          };
          void run().catch(() => undefined).then(sync).finally(() => (running = false));
          return { started: true };
        },
        testQuery: (q) => new GitHubSource({ cfg: githubSettings(settings.load()), token: process.env.GITHUB_TOKEN || undefined }).trySearch(q, new Date()),
        remoteSettings: () => lastRemoteSettings(db),
        extraHealth: () => ({ cloud: cloud ? { projectId: cloud.cfg.projectId, syncMinutes: cloud.cfg.syncMinutes, last: lastSync(db) } : null, lan: host === "0.0.0.0" }),
      });
      if (cloud) {
        void sync();
        setInterval(() => void sync(), cloud.cfg.syncMinutes * 60_000).unref();
      }
      await new Promise<void>((r) => app.listen(port, host, r));
      console.log(`Dashboard: http://${host === "0.0.0.0" ? "<this PC's LAN address>" : "localhost"}:${port}/?t=${token}`);
      console.log("Mở link trên trong trình duyệt. Giữ cửa sổ này mở; bấm Ctrl+C để tắt dashboard.");
      if (host === "0.0.0.0") console.log("LAN mode: anyone on your network with this link can read and change your list. Keep the token private.");
      return await new Promise<number>(() => undefined);
    }
    case "cloud": {
      if (pos[0] !== "connect") {
        console.error("dùng: npm run cloud:connect   (= trend cloud connect [--infra DIR])");
        return 1;
      }
      const infra = typeof flags.get("infra") === "string" ? (flags.get("infra") as string) : join(here, "..", "..", "..", "infra");
      const tf = spawnSync("terraform", [`-chdir=${infra}`, "output", "-json"], { encoding: "utf8" });
      if (tf.error || tf.status !== 0) {
        console.error(tf.error ? "Không chạy được lệnh terraform. Cài Terraform (xem infra/README.md bước 1), mở terminal mới rồi chạy lại." : `terraform output lỗi:\n${tf.stderr}`);
        console.error(`Thư mục Terraform đang dùng: ${infra}  (đổi bằng --infra DIR)`);
        return 1;
      }
      try {
        const c = fromTerraformOutput(tf.stdout);
        mkdirSync(home.dir, { recursive: true });
        writeCloudConfig(home.cloudFile, c);
        console.log(`Đã ghi ${home.cloudFile} (project ${c.projectId}). File này chứa khoá của PC: không gửi cho ai, không commit.`);
      } catch (e) {
        console.error(e instanceof Error ? e.message : e);
        return 1;
      }
      console.log("Bước tiếp theo:  npm run doctor   (đồng bộ thử và kiểm tra đường đi của điện thoại)");
      return 0;
    }
    case "sync": {
      const { db, store, budget } = buildDeps(home, loadHomeConfig(home));
      try {
        const cloud = buildCloud(home, { db, store, budget, log: (m) => console.log(m) });
        if (!cloud) {
          console.error("Chưa bật cloud. Làm theo infra/README.md, rồi chạy: npm run cloud:connect");
          return 1;
        }
        return (await cloud.sync()).ok ? 0 : 2;
      } finally {
        db.close();
      }
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
