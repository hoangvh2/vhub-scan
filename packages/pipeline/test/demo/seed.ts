// Realistic-looking sample data for screenshots and manual UI checks. Fictional projects; not used by any test assertion.
import type { Db } from "../../src/db.js";

interface Demo {
  id: string;
  title: string;
  desc: string;
  author: string;
  topics: string[];
  score: number;
  cat: string;
  why: string;
  stars?: number[];
  points?: number[];
  sources: string[];
  state?: string;
  card?: { what: string; learn: string; apply: { project: string; how: string }[]; effort: "S" | "M" | "L"; risk: string };
  digest?: string;
  license?: string;
}

const D: Demo[] = [
  {
    id: "github:tinyplan/weekboard", title: "tinyplan/weekboard", author: "tinyplan", license: "MIT",
    desc: "Plan your week in a plain Markdown file; a CLI turns it into calendar blocks and a Friday review.",
    topics: ["productivity", "cli", "calendar"], score: 3, cat: "lập kế hoạch",
    why: "Lập kế hoạch tuần bằng Markdown, tự xếp lịch; đúng nhu cầu tổ chức việc cá nhân.",
    stars: [41, 58, 77, 96, 120, 151, 183, 212, 240, 266], sources: ["github", "hn"], digest: "điểm 3, tăng nhanh (+26 sao/ngày)",
    card: {
      what: "CLI đọc một file Markdown kế hoạch tuần, sinh lịch (.ics) theo khung giờ, và tạo bản tổng kết cuối tuần.",
      learn: "Cách giữ dữ liệu ở dạng văn bản thuần mà vẫn tự động hoá được: parser nhỏ, lịch là đầu ra, không khoá vào app nào.",
      apply: [
        { project: "VH Flow", how: "Thêm 'xuất tuần ra lịch' từ danh sách việc; dùng .ics nên chạy được với Google Calendar." },
        { project: "VH Studio", how: "Mẫu 'review thứ Sáu' cho từng dự án, sinh từ lịch sử commit." },
      ],
      effort: "S", risk: "Chưa hỗ trợ lặp lại phức tạp (mỗi thứ Hai thứ hai của tháng); giấy phép MIT, dùng được.",
    },
  },
  {
    id: "github:quietdesk/inbox-zero-agent", title: "quietdesk/inbox-zero-agent", author: "quietdesk", license: "Apache-2.0",
    desc: "A local agent that labels, snoozes and drafts replies for Gmail using rules you write in YAML.",
    topics: ["automation", "agent", "email"], score: 3, cat: "tự động hoá",
    why: "Tác tử chạy cục bộ, luật viết bằng YAML; mẫu tốt cho tự động hoá có kiểm soát.",
    stars: [12, 19, 31, 44, 60, 73, 90, 104, 121, 139], sources: ["github"], digest: "điểm 3, nguồn theo dõi",
    card: {
      what: "Tác tử chạy trên máy bạn, đọc Gmail qua API, gắn nhãn, hoãn, và soạn nháp trả lời theo luật YAML.",
      learn: "Tách 'luật do người viết' khỏi 'phần AI đề xuất'; AI chỉ soạn nháp, không gửi.",
      apply: [{ project: "VH Flow", how: "Cùng mô hình: AI đề xuất việc từ email, người bấm chấp nhận." }],
      effort: "M", risk: "Cần OAuth Gmail (quyền rộng); kiểm tra kỹ phạm vi quyền trước khi thử.",
    },
  },
  {
    id: "url:habito.example.com", title: "Habito", author: "bob",
    desc: "A habit tracker and calendar assistant for busy people.",
    topics: ["show-hn", "habit"], score: 2, cat: "đời sống",
    why: "Theo dõi thói quen gắn với lịch; giao diện gọn, nhiều thảo luận trên HN.",
    points: [12, 38, 64, 81, 92], sources: ["hn"], digest: "điểm 2, HN 92 điểm",
    card: {
      what: "Web app ghi thói quen và đề xuất khung giờ trống trong lịch để làm thói quen đó.",
      learn: "Gợi ý dựa trên khoảng trống thật của lịch thay vì nhắc giờ cố định.",
      apply: [{ project: "VH Flow", how: "Gợi ý giờ làm việc lặp lại dựa trên lịch trống." }],
      effort: "M", risk: "Mã nguồn đóng, chỉ học ý tưởng.",
    },
  },
  {
    id: "github:fernwood/receipt-ledger", title: "fernwood/receipt-ledger", author: "fernwood", license: "MIT",
    desc: "Forward receipts by email, get a monthly spending CSV and a budget report. Self-hosted, SQLite.",
    topics: ["finance", "budget", "self-hosted"], score: 2, cat: "tài chính cá nhân",
    why: "Ghi chi tiêu từ email hoá đơn, tự host bằng SQLite; nhỏ, dễ đọc.",
    stars: [210, 214, 219, 225, 230, 236, 241, 249, 255, 262], sources: ["github"], digest: "điểm 2",
    card: {
      what: "Dịch vụ nhỏ nhận email hoá đơn, trích số tiền và ngày, ghi SQLite, xuất báo cáo tháng.",
      learn: "Đầu vào là email (ai cũng có) thay vì app riêng; trích xuất có kiểm tra bằng tay khi không chắc.",
      apply: [{ project: "VH Studio", how: "Theo dõi chi phí công cụ (API, hosting) từ email hoá đơn." }],
      effort: "S", risk: "Trích xuất bằng regex, hoá đơn tiếng Việt cần thêm mẫu.",
    },
  },
  {
    id: "github:northpaw/standup-bot", title: "northpaw/standup-bot", author: "northpaw", license: "MIT",
    desc: "Generates a daily standup from your git commits, PRs and calendar; posts to Slack or prints it.",
    topics: ["developer-tools", "automation", "claude-code"], score: 2, cat: "quy trình dev",
    why: "Tự viết standup từ commit và lịch; tiết kiệm 10 phút mỗi sáng.",
    stars: [8, 15, 22, 30, 41, 49, 55, 60, 66, 71], sources: ["github"], digest: "điểm 2",
    card: {
      what: "Script đọc git log, PR đã mở/merge và lịch hôm qua, viết bản standup 5 dòng.",
      learn: "Gom nhiều nguồn nhỏ thành một bản tóm tắt cố định định dạng.",
      apply: [{ project: "VH Flow", how: "Báo cáo cuối ngày tự động cho team outsourcing." }],
      effort: "S", risk: "Phụ thuộc định dạng commit message.",
    },
  },
  {
    id: "github:lifehub/planner", title: "lifehub/planner", author: "lifehub", license: "MIT", state: "kept",
    desc: "A calendar assistant for personal life: reminders, budget and a weekly planner you own.",
    topics: ["productivity", "calendar"], score: 3, cat: "lập kế hoạch",
    why: "Trợ lý lịch cá nhân, dữ liệu do bạn giữ; gần với VH Flow.",
    stars: [140, 151, 160, 172, 185, 197, 205, 214, 226, 239], sources: ["github"],
    card: {
      what: "Ứng dụng lịch cá nhân kèm nhắc việc và ngân sách, dữ liệu lưu cục bộ, đồng bộ tuỳ chọn.",
      learn: "Mô hình local-first với đồng bộ tuỳ chọn.",
      apply: [{ project: "VH Flow", how: "Tham khảo cách đồng bộ tuỳ chọn mà không bắt đăng nhập." }],
      effort: "L", risk: "Codebase lớn, chỉ nên học kiến trúc.",
    },
  },
  {
    id: "github:mintcli/clipnote", title: "mintcli/clipnote", author: "mintcli", license: "MIT", state: "trying",
    desc: "Clipboard history that turns copied snippets into searchable notes with tags.",
    topics: ["notes", "cli"], score: 2, cat: "ghi chú",
    why: "Biến clipboard thành ghi chú tìm được; nhỏ gọn.",
    stars: [55, 57, 60, 61, 64, 66, 69, 71, 72, 74], sources: ["github"],
    card: {
      what: "Daemon nhỏ lưu lịch sử clipboard, gắn thẻ tự động, tìm bằng lệnh.",
      learn: "Thu thập thụ động, tổ chức sau.", apply: [{ project: "VH Studio", how: "Lưu đoạn prompt hay dùng." }],
      effort: "S", risk: "Clipboard có thể chứa mật khẩu; cần loại trừ.",
    },
  },
  ...["sprintly/retro-kit|Retro templates and a timer for remote teams|quy trình nhóm|1", "dotfiles-pro/setup-kit|One command to set up a dev laptop with sane defaults|quy trình dev|2", "taskpond/kanban-tui|Kanban board in the terminal backed by a JSON file|lập kế hoạch|2", "mealmap/plan|Weekly meal planner that builds the shopping list|đời sống|1", "focusbar/menubar|Pomodoro timer in the menu bar with daily stats|tập trung|1"].map((s, i): Demo => {
    const [name, desc, cat, score] = s.split("|") as [string, string, string, string];
    return {
      id: `github:${name}`, title: name, author: name.split("/")[0]!, desc, topics: ["productivity"], score: Number(score), cat,
      why: ["Mẫu retro gọn cho nhóm làm từ xa.", "Cài máy dev bằng một lệnh.", "Kanban trong terminal, dữ liệu là JSON.", "Lên thực đơn tuần, tự ra danh sách đi chợ.", "Đồng hồ Pomodoro kèm thống kê ngày."][i]!,
      stars: [20 + i * 7, 22 + i * 7, 25 + i * 8, 27 + i * 8], sources: ["github"], license: "MIT",
    };
  }),
];

export function seedDemo(db: Db, now: Date): void {
  const day = (back: number) => new Date(now.getTime() - back * 86_400_000).toISOString().slice(0, 10);
  const today = day(0);
  db.tx(() => {
    D.forEach((d, rank) => {
      const series = d.stars ?? d.points ?? [];
      db.run(
        `INSERT INTO entity (id, title, description, url, author, language, license, topics, first_seen, last_seen, simhash, stage, content_hash,
           heuristic, triage_score, triage_cat, triage_why, card_json, user_state, shown_at)
         VALUES (?, ?, ?, ?, ?, 'TypeScript', ?, ?, ?, ?, '0', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        d.id, d.title, d.desc, d.id.startsWith("url:") ? `https://${d.id.slice(4)}` : `https://github.com/${d.title}`, d.author, d.license ?? null,
        JSON.stringify(d.topics), new Date(now.getTime() - series.length * 86_400_000).toISOString(), now.toISOString(),
        d.card ? "carded" : "triaged", "h" + rank, 9 - rank * 0.5, d.score, d.cat, d.why, d.card ? JSON.stringify(d.card) : null, d.state ?? "new",
        d.digest ? now.toISOString() : null,
      );
      series.forEach((v, i) => db.run("INSERT INTO observation (entity_id, day, stars, points) VALUES (?, ?, ?, ?)", d.id, day(series.length - 1 - i), d.stars ? v : null, d.points ? v : null));
      for (const s of d.sources) {
        const url = s === "hn" ? `https://news.ycombinator.com/item?id=${4200000 + rank}` : `https://github.com/${d.title}`;
        db.run("INSERT INTO sighting (entity_id, source, source_id, url, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)", d.id, s, d.id, url, now.toISOString(), now.toISOString());
      }
    });
    D.filter((d) => d.digest).forEach((d, i) => db.run("INSERT INTO digest (day, entity_id, rank, reason) VALUES (?, ?, ?, ?)", today, d.id, i, d.digest!));
    const stats = { runId: "demo", collected: 214, created: 63, merged: 9, dropped: { "ngoài phạm vi": 21, "mô tả quá ngắn": 14, cũ: 8 }, scored: 40, triaged: 40, carded: 8, digest: 5, llmCalls: 4, cacheHits: 2, tokensToday: 31840, degraded: [], sourceErrors: [] };
    db.run("INSERT INTO run (id, started_at, finished_at, status, stage, stats, heartbeat) VALUES ('demo', ?, ?, 'ok', 'digest', ?, ?)",
      new Date(now.getTime() - 2.4 * 3_600_000).toISOString(), new Date(now.getTime() - 2.3 * 3_600_000).toISOString(), JSON.stringify(stats), now.toISOString());
    db.run("INSERT INTO token_usage (day, stage, in_tokens, out_tokens, calls, cost_usd) VALUES (?, 'triage', 21000, 2900, 2, 0.041), (?, 'card', 6400, 1540, 2, 0.052)", today, today);
  });
}
