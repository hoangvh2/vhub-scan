import { spawnSync } from "node:child_process";
import type { Home } from "./app.js";
import type { Config } from "./config.js";

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
