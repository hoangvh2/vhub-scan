import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultConfig, parseConfig, type Config } from "../config.js";
import { Db } from "../db.js";
import { Budget } from "../llm/budget.js";
import { LlmRunner } from "../llm/runner.js";
import type { LlmAdapter } from "../llm/types.js";
import type { Clock } from "../model.js";
import { runPipeline, type Deps } from "../pipeline.js";
import { SettingsStore } from "../settingsStore.js";
import { Store } from "../store.js";
import { CONFIG_OBJECT, DB_OBJECT, exportDb } from "./dbsync.js";
import type { DocReader, Primitive } from "./firestore.js";
import { GenerationConflict, type BlobStore } from "./storage.js";
import { applyEvent, byTime, publishSnapshot } from "./sync.js";

/**
 * A scan started from the web or the phone ("Quét bằng Gemini"), run by the Cloud Function in infra/scan.tf.
 *
 * The web or phone creates owners/{uid}/runRequests/{day}-{n}. The Firestore rules allow only n = 1..perDay for
 * today's day number (Vietnam time), so the daily limit holds even if the app is bypassed. The function then:
 * takes the database the PC shared, applies phone actions, scans with Gemini, uploads the database back on the
 * generation it started from, publishes the snapshot, and writes the outcome onto the request.
 */
export const SCAN_REQUESTS = "runRequests";
/** Vietnam has no daylight saving time: day boundaries are fixed at 17:00 UTC. */
export const DAY_OFFSET_MS = 7 * 3_600_000;
const KEEP_DAYS = 14;
/** Extra request ids per day for trying again after failed scans (SCAN_RETRIES in firebase/gen-rules.mjs). */
export const SCAN_RETRIES = 3;
/** A request with no outcome after this long is treated as failed (the function's own timeout is 9 minutes). */
export const SCAN_STALE_MS = 15 * 60_000;

export const scanDay = (ms: number): number => Math.floor((ms + DAY_OFFSET_MS) / 86_400_000);

/**
 * Whether a request uses one of the day's scans: done, or still waiting or running and not stale. Failed, refused and
 * stale ones do not, so a broken scan can be tried again. The Firestore rules (scanUses) apply the same test.
 */
export function scanUses(f: Record<string, unknown>, nowMs: number): boolean {
  const status = f.status === undefined ? "waiting" : f.status;
  if (status === "done") return true;
  return (status === "waiting" || status === "running") && typeof f.at === "number" && f.at > nowMs - SCAN_STALE_MS;
}

export type ScanStatus = "running" | "done" | "failed" | "refused";

export interface ScanJobDeps {
  docs: DocReader;
  blobs: BlobStore;
  uid: string;
  requestId: string;
  clock: Clock;
  /** Scans allowed per day (the same number the rules allow). */
  perDay: number;
  model: string;
  adapter: () => LlmAdapter;
  /** GitHub and Hacker News sources for the config the PC shared. */
  sources: (cfg: Config) => Pick<Deps, "github" | "hn">;
  /** Scratch directory for the database copy (Cloud Functions: under /tmp). */
  workDir: string;
  log?: (m: string) => void;
}

export interface ScanJobResult {
  status: ScanStatus | "missing" | "duplicate";
  message?: string;
}

export async function runCloudScan(d: ScanJobDeps): Promise<ScanJobResult> {
  const path = `owners/${d.uid}/${SCAN_REQUESTS}/${d.requestId}`;
  const req = await d.docs.get(path);
  if (!req) return { status: "missing" };
  // Events can be delivered more than once: only the first delivery runs.
  if (req.fields.status !== undefined) return { status: "duplicate" };

  const now = d.clock.now();
  const finish = async (status: ScanStatus, message: string, extra: Record<string, Primitive> = {}): Promise<ScanJobResult> => {
    await d.docs.update(path, { status, message, finishedAt: d.clock.now().toISOString(), ...extra });
    d.log?.(`scan ${d.requestId}: ${status} ${message}`);
    return { status, message };
  };

  const m = /^(\d{1,7})-(\d{1,2})$/.exec(d.requestId);
  const day = scanDay(now.getTime());
  if (!m || Number(m[1]) !== day || Number(m[2]) < 1 || Number(m[2]) > d.perDay + SCAN_RETRIES) {
    return finish("refused", `Yêu cầu không hợp lệ hoặc đã hết lượt hôm nay (tối đa ${d.perDay} lần/ngày).`);
  }
  // Earlier requests of today: the stuck ones are closed as failed, and only scans that ran (or still run) count.
  const earlier = (await d.docs.list(`owners/${d.uid}/${SCAN_REQUESTS}`)).filter((r) => {
    const x = /^(\d+)-(\d+)$/.exec(r.id);
    return x !== null && Number(x[1]) === day && Number(x[2]) < Number(m[2]);
  });
  for (const r of earlier) {
    const status = r.fields.status;
    if ((status === undefined || status === "running") && !scanUses(r.fields, now.getTime())) {
      await d.docs.update(`owners/${d.uid}/${SCAN_REQUESTS}/${r.id}`, { status: "failed", message: STALE_MESSAGE, finishedAt: now.toISOString() });
    }
  }
  const used = earlier.filter((r) => scanUses(r.fields, now.getTime())).length;
  if (used >= d.perDay) return finish("refused", `Hôm nay đã dùng hết ${d.perDay} lượt quét.`);
  await d.docs.update(path, { status: "running", startedAt: now.toISOString(), model: d.model });

  let db: Db | null = null;
  try {
    const got = await d.blobs.download(DB_OBJECT);
    if (!got) return await finish("failed", "PC chưa gửi dữ liệu lên cloud. Trên PC chạy: npm run cloud:connect rồi npm run sync.");
    const cfgFile = await d.blobs.download(CONFIG_OBJECT);
    const cfg = cfgFile ? parseConfig(cfgFile.bytes.toString("utf8")) : structuredClone(defaultConfig);
    // Same funnel and budget as the PC; only the model changes.
    cfg.llm.triageModel = d.model;
    cfg.llm.cardModel = d.model;

    mkdirSync(d.workDir, { recursive: true });
    const dbFile = join(d.workDir, `${d.requestId}.sqlite`);
    writeFileSync(dbFile, got.bytes);
    const configPath = join(d.workDir, "config.json");
    writeFileSync(configPath, cfgFile ? cfgFile.bytes : JSON.stringify({}));
    db = new Db(dbFile);
    const store = new Store(db, cfg);
    const budget = new Budget(db, cfg.budget.dailyTokens);
    const before = budget.today(now);

    // Phone actions first, so the digest and the snapshot reflect them. Their inbox entries are removed only once
    // the database holding them is safely in the bucket.
    const events = (await d.docs.list(`owners/${d.uid}/inbox`)).sort(byTime);
    for (const e of events) applyEvent({ db, store }, e, now);

    const st = await runPipeline({ cfg, db, store, budget, llm: new LlmRunner(d.adapter(), db, budget), clock: d.clock, ...d.sources(cfg), log: d.log });

    try {
      await d.blobs.upload(DB_OBJECT, exportDb(db), got.generation);
    } catch (e) {
      if (e instanceof GenerationConflict) return await finish("failed", "PC vừa cập nhật dữ liệu trong lúc quét trên cloud, nên kết quả lần này không được lưu. Thử lại sau vài phút.");
      throw e;
    }
    if (events.length) await d.docs.remove(events.map((e) => e.name));
    await publishSnapshot({ db, store, budget, docs: d.docs, uid: d.uid, settings: new SettingsStore(configPath, d.workDir) }, d.clock.now());
    await cleanup(d, now);

    const after = budget.today(d.clock.now());
    const tokens = after.inTokens + after.outTokens - (before.inTokens + before.outTokens);
    const costUsd = Math.round((after.costUsd - before.costUsd) * 1e6) / 1e6;
    const problems = [...st.degraded, ...st.sourceErrors];
    return await finish("done", problems.length ? `Xong, có cảnh báo: ${problems.join("; ").slice(0, 300)}` : "Xong.", {
      tokens, costUsd, llmCalls: st.llmCalls, triaged: st.triaged, carded: st.carded, digest: st.digest,
    });
  } catch (e) {
    return await finish("failed", `Lỗi: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`);
  } finally {
    db?.close();
  }
}

export const STALE_MESSAGE = "Quá thời gian: cloud không trả lời sau 15 phút. Lượt này không tính, có thể quét lại.";

/** Requests older than two weeks are only history: removed so the list the apps read stays short. */
async function cleanup(d: ScanJobDeps, now: Date): Promise<void> {
  const old = (await d.docs.list(`owners/${d.uid}/${SCAN_REQUESTS}`)).filter((r) => {
    const day = Number(/^(\d+)-/.exec(r.id)?.[1] ?? NaN);
    return !Number.isFinite(day) || day < scanDay(now.getTime()) - KEEP_DAYS;
  });
  if (old.length) await d.docs.remove(old.map((r) => r.name));
}
