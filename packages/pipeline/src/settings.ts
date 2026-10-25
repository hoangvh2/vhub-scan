import { createHash } from "node:crypto";
import { categories, defaultConfig, searchQueries, type Config, type Topic } from "./config.js";
import { CLI_FIXED_OVERHEAD_TOKENS, estimateTokens } from "./llm/budget.js";

/**
 * The catalogue of every setting: what it is called, what it changes and which values are valid, in one place.
 * The PC settings page, the hosted web page and the Android app all draw their forms from it (the PC sends it in
 * GET /api/settings and in the cloud snapshot), and the PC validates every change against it, wherever it came from.
 */

export type SettingType = "int" | "number" | "bool" | "text" | "list" | "choice" | "topics" | "projects";
export type Impact = "token" | "time" | "quality";
export type GroupId = "scan" | "filter" | "ai" | "projects" | "system";

export interface SettingDef {
  key: string;
  group: GroupId;
  label: string;
  /** One or two sentences: what it does and what changing it changes. */
  help: string;
  type: SettingType;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** For "choice". */
  options?: { value: string; label: string }[];
  /** "choice" also accepts a value outside `options` (for example a full model id). */
  custom?: boolean;
  /** Longest text, or most items in a list. */
  maxLen?: number;
  impact?: Impact[];
  /** Folded under "Nâng cao" by default. */
  advanced?: boolean;
  /** false: shown, but only editable in config.json on the PC (never through any page or the cloud). */
  editable?: boolean;
  /** false: editable on the PC page only, not from the phone or the hosted web page. */
  remote?: boolean;
  /** When a change takes effect. */
  applies: "next-scan" | "restart";
}

export const GROUPS: { id: GroupId; label: string; help: string }[] = [
  { id: "scan", label: "Quét cái gì", help: "Chủ đề và nguồn quyết định pipeline thu thập những gì mỗi lần quét." },
  { id: "filter", label: "Lọc bỏ gì", help: "Luật cứng chạy trước AI, không tốn token. Đổi luật thì lần quét sau áp dụng lại cho cả ý cũ." },
  { id: "ai", label: "AI làm bao nhiêu", help: "Bao nhiêu ý được đưa cho Claude, model nào, và trần token mỗi ngày." },
  { id: "projects", label: "Dự án của tôi", help: "Claude dùng mô tả dự án để gợi ý cách áp dụng mỗi ý tưởng." },
  { id: "system", label: "Hệ thống", help: "Cài đặt của máy PC." },
];

const MODELS = [
  { value: "haiku", label: "Haiku (rẻ, nhanh)" },
  { value: "sonnet", label: "Sonnet (cân bằng)" },
  { value: "opus", label: "Opus (tốt nhất, đắt nhất)" },
];
const EFFORTS = [
  { value: "low", label: "Thấp" },
  { value: "medium", label: "Vừa" },
  { value: "high", label: "Cao" },
  { value: "", label: "Để CLI tự chọn" },
];

export const SETTINGS: SettingDef[] = [
  // ---------------------------------------------------------------- scan
  {
    key: "topics", group: "scan", type: "topics", label: "Chủ đề tìm kiếm", applies: "next-scan", impact: ["time", "quality"], maxLen: 20,
    help: "Mỗi chủ đề là một nhóm query GitHub và từ khoá. Claude xếp mỗi ý vào một chủ đề đang bật, và dashboard lọc được theo chủ đề. Tắt chủ đề thì không quét nó nữa, ý cũ vẫn giữ.",
  },
  { key: "sources.github.enabled", group: "scan", type: "bool", label: "Quét GitHub", applies: "next-scan", help: "Tìm repo theo query của các chủ đề và theo tài khoản theo dõi." },
  {
    key: "sources.github.seeds", group: "scan", type: "list", label: "Tài khoản GitHub theo dõi", applies: "next-scan", maxLen: 50, impact: ["time"],
    help: "Mỗi lần quét lấy 10 repo mới nhất của mỗi tài khoản (người hoặc tổ chức). Repo từ đây được +1 điểm và không bị loại vì cũ hay mô tả ngắn.",
  },
  {
    key: "sources.github.perQuery", group: "scan", type: "int", label: "Số repo mỗi query", min: 1, max: 100, unit: "repo", applies: "next-scan", impact: ["time"],
    help: "GitHub trả repo nhiều sao nhất trước. Tăng thì thấy nhiều ý hơn nhưng quét lâu hơn; số ý đưa cho AI vẫn bị giới hạn ở phần AI.",
  },
  {
    key: "sources.hn.enabled", group: "scan", type: "bool", label: "Quét Show HN", applies: "next-scan",
    help: "Đọc các bài Show HN mới trên Hacker News. Bài có link GitHub được gộp với repo đó.",
  },
  { key: "sources.hn.maxItems", group: "scan", type: "int", label: "Số bài Show HN mỗi lần", min: 0, max: 200, unit: "bài", applies: "next-scan", impact: ["time"], help: "Chỉ lấy bài mới hơn lần quét trước, tối đa chừng này bài." },
  {
    key: "sources.github.queries", group: "scan", type: "list", label: "Query GitHub thêm", applies: "next-scan", maxLen: 30, impact: ["time"], advanced: true,
    help: "Query chạy thêm, ngoài các chủ đề, theo cú pháp tìm kiếm của GitHub. {d14} nghĩa là ngày cách đây 14 ngày. Kết quả của chúng được xếp vào chủ đề gần nhất hoặc Khác.",
  },
  {
    key: "sources.github.refreshMax", group: "scan", type: "int", label: "Số repo cập nhật sao mỗi lần", min: 0, max: 200, unit: "repo", applies: "next-scan", impact: ["time"], advanced: true,
    help: "Ý đã giữ hoặc đã phân tích được lấy lại số sao (tối đa 2 ngày một lần) để thấy xu hướng. Mỗi repo tốn 1 request GitHub.",
  },
  // ---------------------------------------------------------------- filter
  {
    key: "scope.exclude", group: "filter", type: "list", label: "Từ loại trừ", applies: "next-scan", maxLen: 100,
    help: "Ý có tên, mô tả hoặc topic chứa 1 trong các từ này bị loại ngay, không tốn token. Khớp cả từ, không phân biệt hoa thường.",
  },
  { key: "scope.blockAuthors", group: "filter", type: "list", label: "Tài khoản bị chặn", applies: "next-scan", maxLen: 100, help: "Repo của các tài khoản GitHub này luôn bị loại." },
  {
    key: "scope.include", group: "filter", type: "list", label: "Từ khoá ưu tiên chung", applies: "next-scan", maxLen: 100, advanced: true,
    help: "Mỗi từ khớp +0,5 điểm công thức, tối đa +1,5. Từ khoá của các chủ đề đang bật được cộng thêm vào danh sách này.",
  },
  { key: "rules.maxAgeDays", group: "filter", type: "int", label: "Tuổi tối đa repo GitHub", min: 1, max: 3650, unit: "ngày", applies: "next-scan", advanced: true, help: "Repo cũ hơn bị loại, trừ khi đang tăng nhanh (xem ngưỡng bên dưới). Chỉ xét lúc ý mới vào." },
  { key: "rules.hnMaxAgeDays", group: "filter", type: "int", label: "Tuổi tối đa bài Show HN", min: 1, max: 365, unit: "ngày", applies: "next-scan", advanced: true, help: "Như trên, cho ý chỉ thấy trên Hacker News." },
  {
    key: "rules.minVelocityForOld", group: "filter", type: "number", label: "Ngưỡng tăng để giữ ý cũ", min: 0, max: 1000, step: 0.5, unit: "sao/ngày", applies: "next-scan", advanced: true,
    help: "Ý quá tuổi vẫn được giữ nếu tăng ít nhất chừng này sao (hoặc điểm HN) mỗi ngày.",
  },
  { key: "rules.minDescriptionChars", group: "filter", type: "int", label: "Mô tả ngắn nhất", min: 0, max: 500, unit: "ký tự", applies: "next-scan", advanced: true, help: "Mô tả ngắn hơn bị loại vì không đủ thông tin để đánh giá." },
  {
    key: "dedupe.hammingMax", group: "filter", type: "int", label: "Độ giống để gộp trùng", min: 0, max: 16, applies: "next-scan", advanced: true,
    help: "Khoảng cách SimHash (dấu vân tay của mô tả) tối đa để coi hai ý là một. 0 = chỉ gộp khi gần như giống hệt; lớn hơn = gộp mạnh tay hơn.",
  },
  {
    key: "dedupe.titleJaccardMin", group: "filter", type: "number", label: "Tên giống tối thiểu để gộp", min: 0, max: 1, step: 0.05, applies: "next-scan", advanced: true,
    help: "Tỉ lệ từ chung của hai tên (0 đến 1) cần có, thêm vào điều kiện trên, để gộp.",
  },
  // ---------------------------------------------------------------- ai
  {
    key: "scope.focus", group: "ai", type: "text", label: "Tiêu chí chấm của AI", applies: "next-scan", maxLen: 600, impact: ["quality"],
    help: "Một đoạn mô tả loại ý tưởng bạn muốn. Claude dùng nó để chấm điểm 0–3 và viết thẻ. Viết tiếng Anh tốn ít token hơn.",
  },
  {
    key: "funnel.triageTop", group: "ai", type: "int", label: "Số ý đưa AI chấm mỗi lần", min: 0, max: 200, unit: "ý", applies: "next-scan", impact: ["token", "quality"],
    help: "Chỉ các ý có điểm công thức cao nhất được Claude chấm. Tăng thì ít bỏ sót hơn nhưng tốn token hơn; ảnh hưởng token lớn nhất.",
  },
  { key: "funnel.cardTop", group: "ai", type: "int", label: "Số thẻ chi tiết tối đa mỗi lần", min: 0, max: 50, unit: "thẻ", applies: "next-scan", impact: ["token"], help: "Thẻ (là gì, học được gì, áp dụng vào dự án nào) do model viết thẻ tạo, đắt hơn bước chấm." },
  { key: "funnel.cardMinScore", group: "ai", type: "int", label: "Điểm tối thiểu để viết thẻ", min: 0, max: 3, applies: "next-scan", impact: ["token", "quality"], help: "Ý có điểm AI từ mức này trở lên mới được viết thẻ và vào Hôm nay. 3 = chỉ ý rất hợp." },
  { key: "funnel.digestSize", group: "ai", type: "int", label: "Số ý trong Hôm nay", min: 1, max: 30, unit: "ý", applies: "next-scan", help: "Bản tin mỗi ngày chọn chừng này ý, ưu tiên ý đã có thẻ. Chạy lại trong ngày không đổi bản tin." },
  {
    key: "budget.dailyTokens", group: "ai", type: "int", label: "Trần token mỗi ngày", min: 0, max: 2_000_000, step: 5000, unit: "token", applies: "next-scan", impact: ["token"],
    help: "Hết trần thì các bước AI tạm dừng tới hôm sau; lần quét vẫn kết thúc và bản tin vẫn có, đánh dấu 'chưa phân tích bằng AI'. 0 = tắt hẳn AI.",
  },
  { key: "llm.triageModel", group: "ai", type: "choice", options: MODELS, custom: true, label: "Model chấm điểm", applies: "next-scan", impact: ["token", "quality"], help: "Bước chấm nhiều ý một lúc nên dùng model rẻ." },
  { key: "llm.cardModel", group: "ai", type: "choice", options: MODELS, custom: true, label: "Model viết thẻ", applies: "next-scan", impact: ["token", "quality"], help: "Bước viết thẻ ít ý hơn, cần viết hay hơn." },
  {
    key: "llm.triageEffort", group: "ai", type: "choice", options: EFFORTS, label: "Mức suy nghĩ khi chấm", applies: "next-scan", impact: ["token", "time"], advanced: true,
    help: "Đã đo: Thấp giảm token đầu ra khoảng 4 lần và nhanh hơn 2,5 lần, điểm không đổi.",
  },
  { key: "llm.cardEffort", group: "ai", type: "choice", options: EFFORTS, label: "Mức suy nghĩ khi viết thẻ", applies: "next-scan", impact: ["token", "time"], advanced: true, help: "Cao hơn thì thẻ kỹ hơn nhưng tốn token và chậm hơn." },
  { key: "funnel.triageBatch", group: "ai", type: "int", label: "Số ý mỗi lần gọi chấm", min: 1, max: 50, unit: "ý", applies: "next-scan", impact: ["token"], advanced: true, help: "Mỗi lần gọi Claude tốn khoảng 3.700 token cố định, nên gộp nhiều ý một lần thì rẻ hơn." },
  { key: "funnel.cardBatch", group: "ai", type: "int", label: "Số ý mỗi lần gọi viết thẻ", min: 1, max: 20, unit: "ý", applies: "next-scan", impact: ["token"], advanced: true, help: "Như trên, cho bước viết thẻ." },
  { key: "funnel.descriptionChars", group: "ai", type: "int", label: "Độ dài mô tả gửi AI", min: 40, max: 1000, unit: "ký tự", applies: "next-scan", impact: ["token", "quality"], advanced: true, help: "Mô tả bị cắt ở độ dài này khi chấm điểm." },
  { key: "funnel.readmeChars", group: "ai", type: "int", label: "Độ dài README gửi AI", min: 0, max: 8000, unit: "ký tự", applies: "next-scan", impact: ["token", "quality"], advanced: true, help: "Phần đầu README được gửi kèm khi viết thẻ. 0 = không gửi." },
  { key: "llm.timeoutMs", group: "ai", type: "int", label: "Thời gian chờ mỗi lần gọi", min: 10_000, max: 900_000, step: 10_000, unit: "ms", applies: "next-scan", advanced: true, help: "Quá thời gian này thì lần gọi bị huỷ và thử lại (tối đa 2 lần)." },
  { key: "llm.command", group: "ai", type: "text", label: "Lệnh Claude CLI", applies: "next-scan", maxLen: 400, advanced: true, editable: false, help: "Đường dẫn chạy Claude CLI trên PC. Vì lý do an toàn chỉ sửa trực tiếp trong config.json." },
  {
    key: "llm.kind", group: "ai", type: "choice", options: [{ value: "claude-cli", label: "Claude CLI" }, { value: "fake", label: "Giả lập (kiểm thử)" }], label: "Bộ chạy AI", applies: "next-scan", advanced: true, editable: false,
    help: "Giả lập chỉ dùng để kiểm thử. Chỉ sửa trong config.json.",
  },
  // ---------------------------------------------------------------- projects
  { key: "projects", group: "projects", type: "projects", label: "Dự án", applies: "next-scan", maxLen: 10, impact: ["quality"], help: "Tên và 1–2 câu mô tả: dự án làm gì, cho ai. Mỗi thẻ gợi ý tối đa 2 cách áp dụng vào các dự án này." },
  // ---------------------------------------------------------------- system
  { key: "server.port", group: "system", type: "int", label: "Cổng dashboard", min: 1024, max: 65535, applies: "restart", remote: false, help: "Dashboard chạy ở http://localhost:<cổng>. Đổi xong phải tắt và mở lại npm run dashboard." },
];

const BY_KEY = new Map(SETTINGS.map((d) => [d.key, d]));
export const settingDef = (key: string): SettingDef | undefined => BY_KEY.get(key);

type Json = Record<string, unknown>;

export function getPath(obj: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Json)[k] : undefined), obj);
}

function setPath(obj: Json, key: string, value: unknown): void {
  const parts = key.split(".");
  let o = obj;
  for (const p of parts.slice(0, -1)) o = (o[p] ??= {}) as Json;
  o[parts.at(-1)!] = value;
}

export const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const TOPIC_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9.:\-[\]]{0,79}$/;

/** Lower-case ASCII slug for a new topic's id ("Tài chính cá nhân" -> "tai-chinh-ca-nhan"). */
export function slugify(label: string): string {
  return (
    label
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[đĐ]/g, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32)
      .replace(/-+$/, "") || "chu-de"
  );
}

function stringList(v: unknown, maxItems: number, maxChars: number, what: string): string | null {
  if (!Array.isArray(v)) return "phải là danh sách";
  if (v.length > maxItems) return `tối đa ${maxItems} ${what}`;
  for (const x of v) {
    if (typeof x !== "string") return "mỗi mục phải là chữ";
    if (!x.trim()) return "có mục để trống";
    if (x.length > maxChars) return `mỗi mục tối đa ${maxChars} ký tự`;
  }
  return null;
}

function validateTopics(v: unknown, max: number): string | null {
  if (!Array.isArray(v)) return "phải là danh sách chủ đề";
  if (v.length > max) return `tối đa ${max} chủ đề`;
  const ids = new Set<string>();
  for (const [i, raw] of v.entries()) {
    const n = `chủ đề ${i + 1}`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return `${n}: sai định dạng`;
    const t = raw as Partial<Topic>;
    const extra = Object.keys(t).filter((k) => !["id", "label", "enabled", "queries", "keywords"].includes(k));
    if (extra.length) return `${n}: không biết trường ${extra.join(", ")}`;
    if (typeof t.id !== "string" || !TOPIC_ID.test(t.id)) return `${n}: mã chỉ gồm chữ thường không dấu, số và dấu gạch ngang (tối đa 32 ký tự)`;
    if (t.id === "other") return `${n}: mã "other" dành cho nhóm Khác`;
    if (ids.has(t.id)) return `${n}: mã "${t.id}" bị trùng`;
    ids.add(t.id);
    if (typeof t.label !== "string" || !t.label.trim() || t.label.length > 40) return `${n}: tên từ 1 đến 40 ký tự`;
    if (typeof t.enabled !== "boolean") return `${n}: thiếu bật/tắt`;
    const q = stringList(t.queries, 10, 200, "query");
    if (q) return `${n} (${t.label}), query: ${q}`;
    const k = stringList(t.keywords, 40, 60, "từ khoá");
    if (k) return `${n} (${t.label}), từ khoá: ${k}`;
  }
  return null;
}

function validateProjects(v: unknown, max: number): string | null {
  if (!Array.isArray(v)) return "phải là danh sách dự án";
  if (v.length > max) return `tối đa ${max} dự án`;
  for (const [i, raw] of v.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return `dự án ${i + 1}: sai định dạng`;
    const p = raw as Json;
    if (Object.keys(p).some((k) => k !== "name" && k !== "summary")) return `dự án ${i + 1}: chỉ có tên và mô tả`;
    if (typeof p.name !== "string" || !p.name.trim() || p.name.length > 40) return `dự án ${i + 1}: tên từ 1 đến 40 ký tự`;
    if (typeof p.summary !== "string" || !p.summary.trim() || p.summary.length > 300) return `dự án ${i + 1}: mô tả từ 1 đến 300 ký tự`;
  }
  return null;
}

/** Why `v` is not a valid value for the setting, or null when it is. Messages are shown to the user as they are. */
export function validateValue(def: SettingDef, v: unknown): string | null {
  switch (def.type) {
    case "int":
    case "number": {
      if (typeof v !== "number" || !Number.isFinite(v)) return "phải là số";
      if (def.type === "int" && !Number.isInteger(v)) return "phải là số nguyên";
      if (def.min !== undefined && v < def.min) return `nhỏ nhất là ${def.min}`;
      if (def.max !== undefined && v > def.max) return `lớn nhất là ${def.max}`;
      return null;
    }
    case "bool":
      return typeof v === "boolean" ? null : "phải là bật hoặc tắt";
    case "text":
      if (typeof v !== "string") return "phải là chữ";
      if (!v.trim()) return "không được để trống";
      return v.length > (def.maxLen ?? 600) ? `tối đa ${def.maxLen ?? 600} ký tự` : null;
    case "list":
      return stringList(v, def.maxLen ?? 100, 200, "mục");
    case "choice":
      if (typeof v !== "string") return "phải chọn một giá trị";
      if (def.options?.some((o) => o.value === v)) return null;
      return def.custom && MODEL.test(v) ? null : `chọn một trong: ${(def.options ?? []).map((o) => o.label).join(", ")}`;
    case "topics":
      return validateTopics(v, def.maxLen ?? 20);
    case "projects":
      return validateProjects(v, def.maxLen ?? 10);
  }
}

export interface PatchResult {
  config: Config;
  changed: string[];
  errors: { key: string; problem: string }[];
}

/**
 * Applies `patch` (setting key -> new value) to `cfg`. Nothing is applied if any entry is invalid. `origin` "remote"
 * (phone, hosted web) may not touch settings marked remote: false; no origin may touch editable: false.
 */
export function applyPatch(cfg: Config, patch: unknown, origin: "local" | "remote"): PatchResult {
  const errors: PatchResult["errors"] = [];
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return { config: cfg, changed: [], errors: [{ key: "", problem: "thay đổi phải là một object" }] };
  const next = structuredClone(cfg) as unknown as Json;
  const changed: string[] = [];
  for (const [key, value] of Object.entries(patch as Json)) {
    const def = BY_KEY.get(key);
    if (!def) {
      errors.push({ key, problem: "không có cài đặt này" });
      continue;
    }
    if (def.editable === false) {
      errors.push({ key, problem: "chỉ sửa được trong config.json trên PC" });
      continue;
    }
    if (origin === "remote" && def.remote === false) {
      errors.push({ key, problem: "chỉ sửa được trên dashboard của PC" });
      continue;
    }
    const problem = validateValue(def, value);
    if (problem) {
      errors.push({ key, problem });
      continue;
    }
    if (!sameValue(getPath(next, key), value)) {
      setPath(next, key, structuredClone(value));
      changed.push(key);
    }
  }
  return errors.length ? { config: cfg, changed: [], errors } : { config: next as unknown as Config, changed, errors };
}

/** Problems in a whole config (for example one edited by hand). Empty when every setting is valid. */
export function validateConfig(cfg: Config): { key: string; problem: string }[] {
  return SETTINGS.flatMap((d) => {
    const p = validateValue(d, getPath(cfg, d.key));
    return p ? [{ key: d.key, problem: p }] : [];
  });
}

/** Only the settings that differ from the defaults, nested like config.json. What the settings page writes. */
export function diffFromDefaults(cfg: Config): Json {
  const out: Json = {};
  for (const d of SETTINGS) {
    const v = getPath(cfg, d.key);
    if (!sameValue(v, getPath(defaultConfig, d.key))) setPath(out, d.key, v);
  }
  return out;
}

export interface RunEstimate {
  /** GitHub searches + seed accounts per run. */
  searches: number;
  triageCalls: number;
  cardCalls: number;
  /** Upper bound per run when every slot is filled and nothing comes from the cache. */
  tokens: number;
}

/** Rough upper bound of one run's cost, from the same per-call formula the budget check uses. An estimate, not a measurement. */
export function estimateRun(cfg: Config): RunEstimate {
  const f = cfg.funnel;
  const cats = categories(cfg).map((c) => `${c.id} (${c.label})`).join(", ").length;
  const triageSystem = 420 + cfg.scope.focus.length + cats;
  const triageCalls = f.triageTop > 0 ? Math.ceil(f.triageTop / f.triageBatch) : 0;
  const triagePerItem = 60 + f.descriptionChars + 60;
  let tokens = 0;
  for (let i = 0; i < triageCalls; i++) {
    const n = Math.min(f.triageBatch, f.triageTop - i * f.triageBatch);
    tokens += CLI_FIXED_OVERHEAD_TOKENS + estimateTokens(triageSystem + n * triagePerItem) + 200 + n * 120;
  }
  const cardSystem = 560 + cfg.scope.focus.length + cfg.projects.reduce((a, p) => a + p.name.length + Math.min(160, p.summary.length) + 4, 0);
  const cardCalls = f.cardTop > 0 ? Math.ceil(f.cardTop / f.cardBatch) : 0;
  const cardPerItem = 60 + 300 + f.readmeChars + 20;
  for (let i = 0; i < cardCalls; i++) {
    const n = Math.min(f.cardBatch, f.cardTop - i * f.cardBatch);
    tokens += CLI_FIXED_OVERHEAD_TOKENS + estimateTokens(cardSystem + n * cardPerItem) + 300 + n * 350;
  }
  const searches = cfg.sources.github.enabled ? searchQueries(cfg).length + cfg.sources.github.seeds.length : 0;
  return { searches, triageCalls, cardCalls, tokens };
}

/** What a settings form needs: the catalogue, current values, defaults, and a revision to detect concurrent edits. */
export interface SettingsView {
  groups: typeof GROUPS;
  defs: SettingDef[];
  values: Record<string, unknown>;
  defaults: Record<string, unknown>;
  /** Changes whenever any value changes. A save that names an older revision is refused (someone else saved first). */
  rev: string;
  estimate: RunEstimate;
  /** Category id -> label, including disabled topics and categories from before topics existed. `active`: offered as a filter. */
  categories: { id: string; label: string; active: boolean }[];
}

export function settingsView(cfg: Config, legacy: Record<string, string> = {}): SettingsView {
  const values = Object.fromEntries(SETTINGS.map((d) => [d.key, getPath(cfg, d.key)]));
  const defaults = Object.fromEntries(SETTINGS.map((d) => [d.key, getPath(defaultConfig, d.key)]));
  const known = categories(cfg).map((c) => ({ ...c, active: true }));
  // Disabled topics and older category ids still label the items filed under them earlier.
  const all = [
    ...known,
    ...cfg.topics.filter((t) => !t.enabled).map((t) => ({ id: t.id, label: t.label, active: false })),
    ...Object.entries(legacy).map(([id, label]) => ({ id, label, active: false })),
  ];
  const seen = new Set<string>();
  return {
    groups: GROUPS,
    defs: SETTINGS,
    values,
    defaults,
    rev: revOf(cfg),
    estimate: estimateRun(cfg),
    categories: all.filter((c) => !seen.has(c.id) && seen.add(c.id)),
  };
}

export function revOf(cfg: Config): string {
  const values = SETTINGS.map((d) => getPath(cfg, d.key));
  return createHash("sha256").update(JSON.stringify(values)).digest("hex").slice(0, 16);
}
