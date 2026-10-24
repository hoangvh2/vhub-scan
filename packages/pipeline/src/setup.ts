import { spawnSync } from "node:child_process";
import type { Home } from "./app.js";
import type { Config } from "./config.js";
import type { RunStats } from "./pipeline.js";
import type { FetchLike } from "./sources/http.js";

/** Text that marks a value in config.example.json the user still has to replace. */
export const TODO_MARK = "TODO:";

export interface SetupIssue {
  /** "fail": the run would give poor results until fixed. "warn": works, but worse. */
  level: "fail" | "warn";
  field: string;
  problem: string;
  fix: string;
}

/** Things in a loaded config that the user still has to fill in. Pure, so tests cover every message. */
export function checkConfig(cfg: Config): SetupIssue[] {
  const out: SetupIssue[] = [];
  if (cfg.projects.length === 0) {
    out.push({
      level: "warn",
      field: "projects",
      problem: "chưa có dự án nào, nên thẻ ý tưởng không gợi ý được cách áp dụng vào dự án của bạn",
      fix: 'thêm ít nhất 1 dự án, ví dụ { "name": "VH Flow", "summary": "App quản lý việc hằng ngày cho team nhỏ" }',
    });
  }
  cfg.projects.forEach((p, i) => {
    if (!p.name.trim() || p.name.startsWith(TODO_MARK)) {
      out.push({ level: "fail", field: `projects[${i}].name`, problem: "còn để trống hoặc còn chữ TODO", fix: "ghi tên dự án, ví dụ \"VH Flow\"" });
    }
    if (!p.summary.trim() || p.summary.startsWith(TODO_MARK)) {
      out.push({
        level: "fail",
        field: `projects[${i}].summary (${p.name || "?"})`,
        problem: "còn để trống hoặc còn chữ TODO",
        fix: "thay bằng 1–2 câu: dự án làm gì, cho ai. Không muốn khai dự án này thì xoá cả khối { ... } của nó",
      });
    }
  });
  if (cfg.sources.github.enabled && cfg.sources.github.queries.length === 0 && cfg.sources.github.seeds.length === 0) {
    out.push({ level: "warn", field: "sources.github", problem: "bật GitHub nhưng không có queries hay seeds nào", fix: "giữ các queries mẫu, hoặc thêm tên tài khoản GitHub vào seeds" });
  }
  return out;
}

export interface Platform {
  os: NodeJS.Platform;
  githubToken: boolean;
}

function openCmd(os: NodeJS.Platform, file: string): string {
  if (os === "win32") return `notepad "${file}"`;
  if (os === "darwin") return `open -e "${file}"`;
  return `nano "${file}"`;
}

function setTokenCmd(os: NodeJS.Platform): string[] {
  if (os === "win32") return ['setx GITHUB_TOKEN "github_pat_xxx"', "rồi ĐÓNG cửa sổ terminal và mở cửa sổ mới (setx chỉ có hiệu lực ở cửa sổ mới)"];
  const rc = os === "darwin" ? "~/.zshrc" : "~/.bashrc";
  return [`echo 'export GITHUB_TOKEN="github_pat_xxx"' >> ${rc}`, `rồi chạy: source ${rc}`];
}

/** What `init` prints: every step, in order, with the exact file, fields and commands. */
export function initGuide(home: Home, created: boolean, p: Platform): string {
  const L: string[] = [];
  L.push(created ? `Đã tạo thư mục dữ liệu: ${home.dir}` : `Thư mục dữ liệu đã có sẵn, không ghi đè gì: ${home.dir}`);
  L.push(`  config: ${home.configFile}`);
  L.push(`  token dashboard: ${home.tokenFile}`);
  L.push("");
  L.push("Làm tiếp 3 bước sau:");
  L.push("");
  L.push("BƯỚC 1. Sửa config (bắt buộc)");
  L.push(`  Mở file:  ${openCmd(p.os, home.configFile)}`);
  L.push(`  Tìm mọi chỗ có chữ "${TODO_MARK}" trong "projects" và thay bằng mô tả thật:`);
  L.push('    "name":    tên dự án của bạn, ví dụ "VH Flow"');
  L.push('    "summary": 1–2 câu, dự án làm gì và cho ai, ví dụ "App quản lý việc hằng ngày cho team nhỏ"');
  L.push("  Không muốn khai một dự án thì xoá cả khối { ... } của nó.");
  L.push('  Không bắt buộc: thêm tên tài khoản GitHub bạn muốn theo dõi vào "sources.github.seeds", ví dụ ["anthropics"].');
  L.push('  Các dòng "_huong_dan" trong file chỉ là ghi chú, chương trình bỏ qua.');
  L.push("");
  L.push(`BƯỚC 2. Đặt GITHUB_TOKEN (nên làm${p.githubToken ? "; máy này ĐÃ có, bỏ qua được" : ""})`);
  L.push("  Không có token, GitHub chỉ cho 60 request/giờ nên lần chạy dễ thiếu dữ liệu.");
  L.push("  a. Mở https://github.com/settings/personal-access-tokens/new");
  L.push('  b. Token name: vhub-trend. Repository access: "Public repositories". Không cần cấp quyền nào. Bấm Generate token, copy.');
  const [cmd, after] = setTokenCmd(p.os);
  L.push(`  c. Chạy (thay github_pat_xxx bằng token vừa copy):  ${cmd}`);
  L.push(`     ${after}`);
  L.push("");
  L.push("BƯỚC 3. Kiểm tra mọi thứ");
  L.push("  Cần Claude CLI đã đăng nhập: gõ  claude  một lần, đăng nhập, rồi thoát.");
  L.push("  Chạy:  npm run doctor");
  L.push("  doctor sẽ báo dòng nào còn thiếu và cách sửa. Khi tất cả là ok, chạy:  npm run scan  rồi  npm run dashboard");
  return L.join("\n");
}

/** Version of the CLI behind `command`, or the reason it cannot run. */
export function probeCommand(command: string, timeoutMs = 15_000): { ok: true; version: string } | { ok: false; reason: string } {
  const r = spawnSync(command, ["--version"], { encoding: "utf8", timeout: timeoutMs, windowsHide: true });
  if (r.error) return { ok: false, reason: r.error.message };
  if (r.status !== 0) return { ok: false, reason: (r.stderr || r.stdout || `exit ${r.status}`).trim() };
  return { ok: true, version: r.stdout.trim() };
}

export type Check = { level: "ok" | "warn" | "fail"; msg: string; fix?: string };

const TOKEN_FIX = "xem BƯỚC 2 trong hướng dẫn của: npm run setup";

/** Asks GitHub whether the token works. /rate_limit does not count against the quota. */
export async function checkGithubToken(token: string | undefined, fetchImpl: FetchLike = fetch): Promise<Check> {
  let res: Response;
  try {
    res = await fetchImpl("https://api.github.com/rate_limit", {
      headers: { "user-agent": "vhub-trend-scan/0.1 (+personal use)", accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    return { level: "warn", msg: `không kết nối được api.github.com (${e instanceof Error ? e.message : e})`, fix: "kiểm tra mạng, proxy hoặc tường lửa" };
  }
  if (res.status === 401) return { level: "fail", msg: "GITHUB_TOKEN sai hoặc đã hết hạn (GitHub trả 401)", fix: `tạo token mới và đặt lại; ${TOKEN_FIX}` };
  if (!res.ok) return { level: "warn", msg: `GitHub trả HTTP ${res.status} khi kiểm tra token` };
  const body = (await res.json()) as { resources?: { core?: { limit?: number; remaining?: number } } };
  const core = body.resources?.core;
  const quota = core ? ` (còn ${core.remaining}/${core.limit} request trong giờ này)` : "";
  if (!token) return { level: "warn", msg: `chưa đặt GITHUB_TOKEN: GitHub chỉ cho 60 request/giờ${quota}, lần chạy dễ thiếu dữ liệu`, fix: TOKEN_FIX };
  return { level: "ok", msg: `GITHUB_TOKEN hợp lệ${quota}` };
}

function explainSourceError(e: string): string {
  if (/HTTP 401/.test(e)) return `GITHUB_TOKEN sai hoặc hết hạn. Cách sửa: ${TOKEN_FIX}, rồi npm run doctor`;
  if (/rate limit/.test(e)) return "hết lượt gọi GitHub. Đặt GITHUB_TOKEN (BƯỚC 2 của npm run setup) hoặc chạy lại sau 1 giờ";
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|aborted|timeout/i.test(e)) return "không kết nối được nguồn này. Kiểm tra mạng rồi chạy lại npm run scan";
  return "chạy lại npm run scan; nếu vẫn lỗi, gửi dòng này cho người bảo trì";
}

/** Human summary of one run: what happened, and for each problem what to do next. */
export function runSummary(st: RunStats): string {
  const L: string[] = [];
  const dropped = Object.values(st.dropped).reduce((a, b) => a + b, 0);
  L.push(`Thu thập ${st.collected} mục (mới ${st.created}, gộp trùng ${st.merged}), loại bởi luật ${dropped}, Claude chấm ${st.triaged}, viết thẻ ${st.carded}.`);
  L.push(`Digest hôm nay: ${st.digest} ý tưởng. Claude: ${st.llmCalls} lần gọi, ${st.cacheHits} lần dùng lại cache, ${st.tokensToday} token hôm nay.`);
  for (const e of st.sourceErrors) L.push(`[LỖI] ${e}\n      cách sửa: ${explainSourceError(e)}`);
  for (const d of st.degraded) {
    if (d.endsWith(":budget")) L.push(`[chú ý] ${d}: hết ngân sách token hôm nay (budget.dailyTokens). Phần còn lại tự chạy tiếp ở lần sau`);
    else if (d.endsWith(":error")) L.push(`[chú ý] ${d}: Claude lỗi nhiều lần. Chạy npm run doctor để kiểm tra, rồi npm run scan lại (phần đã xong không làm lại)`);
    else if (d === "digest:partial") L.push("[chú ý] digest chưa đủ thẻ chi tiết; chạy lại npm run scan để làm tiếp");
    else L.push(`[chú ý] ${d}`);
  }
  if (st.digest > 0) L.push("\nXem kết quả:  npm run dashboard");
  else if (!st.sourceErrors.length) L.push("\nHôm nay chưa có ý tưởng mới. Thử thêm seeds hoặc queries trong config, rồi npm run scan");
  else L.push("\nSửa các dòng [LỖI] ở trên rồi chạy lại:  npm run scan");
  return L.join("\n");
}
