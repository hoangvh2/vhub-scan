import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { canonicalKey } from "./canonical.js";
import { Budget } from "./llm/budget.js";
import type { LlmRunner } from "./llm/runner.js";
import { dayOf, type Clock, type EntityRow, type RawItem } from "./model.js";
import {
  CARD_VERSION, CATEGORIES, TRIAGE_VERSION, cardBlock, cardSchema, cardSystem, triageLine, triageSchema, triageSystem,
} from "./prompts.js";
import { applyRules } from "./rules.js";
import { heuristic, velocity, type Obs } from "./score.js";
import type { GitHubSource } from "./sources/github.js";
import type { HackerNewsSource } from "./sources/hackernews.js";
import { RateLimited } from "./sources/http.js";
import type { Store } from "./store.js";

export const STAGES = ["collect", "refresh", "rules", "score", "triage", "enrich", "card", "digest"] as const;
export type StageName = (typeof STAGES)[number];

export interface Deps {
  cfg: Config;
  db: Db;
  store: Store;
  llm: LlmRunner;
  budget: Budget;
  clock: Clock;
  github?: GitHubSource;
  hn?: (lastMaxId: number) => HackerNewsSource;
  /** Tests throw from here to simulate a crash after a stage. */
  afterStage?: (stage: StageName) => void;
  log?: (msg: string) => void;
}

export interface RunStats {
  runId: string;
  collected: number;
  created: number;
  merged: number;
  dropped: Record<string, number>;
  scored: number;
  triaged: number;
  carded: number;
  digest: number;
  llmCalls: number;
  cacheHits: number;
  tokensToday: number;
  degraded: string[];
  sourceErrors: string[];
}

const STALE_LOCK_MS = 30 * 60_000;

function isAlive(pid: number | null): boolean {
  if (pid === null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function runPipeline(d: Deps): Promise<RunStats> {
  const now = d.clock.now();
  const iso = now.toISOString();
  const runId = `${iso.replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
  const live = d.db.get<{ id: string; heartbeat: string; pid: number | null }>(
    "SELECT id, heartbeat, pid FROM run WHERE status = 'running' ORDER BY started_at DESC LIMIT 1",
  );
  if (live && now.getTime() - Date.parse(live.heartbeat) < STALE_LOCK_MS && isAlive(live.pid)) throw new Error(`another run is active (${live.id})`);
  // A killed run left 'running' behind: mark it, then simply run again. Every stage is idempotent, so that is the resume.
  d.db.run("UPDATE run SET status = 'interrupted', finished_at = ? WHERE status = 'running'", iso);
  d.db.run("INSERT INTO run (id, started_at, status, heartbeat, pid) VALUES (?, ?, 'running', ?, ?)", runId, iso, iso, process.pid);

  const st: RunStats = {
    runId, collected: 0, created: 0, merged: 0, dropped: {}, scored: 0, triaged: 0, carded: 0, digest: 0,
    llmCalls: 0, cacheHits: 0, tokensToday: 0, degraded: [], sourceErrors: [],
  };
  const calls0 = d.llm.calls;
  const hits0 = d.llm.cacheHits;
  const mark = (stage: StageName) => {
    d.db.run("UPDATE run SET stage = ?, heartbeat = ?, stats = ? WHERE id = ?", stage, d.clock.now().toISOString(), JSON.stringify(st), runId);
    d.afterStage?.(stage);
  };

  try {
    await collect(d, st, now);
    mark("collect");
    await refresh(d, now);
    mark("refresh");
    rules(d, st, now);
    mark("rules");
    score(d, st, now);
    mark("score");
    await triage(d, st, now);
    mark("triage");
    await enrich(d);
    mark("enrich");
    await card(d, st, now);
    mark("card");
    digest(d, st, now);
    mark("digest");
    st.llmCalls = d.llm.calls - calls0;
    st.cacheHits = d.llm.cacheHits - hits0;
    st.tokensToday = d.budget.used(now);
    d.db.run("UPDATE run SET status = 'ok', finished_at = ?, stats = ?, heartbeat = ? WHERE id = ?", d.clock.now().toISOString(), JSON.stringify(st), iso, runId);
    return st;
  } catch (e) {
    d.db.run("UPDATE run SET status = 'failed', finished_at = ?, error = ? WHERE id = ?", d.clock.now().toISOString(), String(e instanceof Error ? e.message : e).slice(0, 300), runId);
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------- collect

async function collect(d: Deps, st: RunStats, now: Date): Promise<void> {
  const resolved = new Map<string, RawItem | null>();
  const resolveGithub = async (item: RawItem): Promise<RawItem[]> => {
    const key = canonicalKey(item.url);
    if (!d.github || !key.startsWith("github:")) return [item];
    const name = key.slice("github:".length);
    if (!resolved.has(name)) {
      try {
        resolved.set(name, await d.github.repo(name));
      } catch (e) {
        if (!(e instanceof RateLimited)) throw e;
        resolved.set(name, null);
      }
    }
    const repo = resolved.get(name);
    return repo ? [repo, item] : [item];
  };

  const ingest = (items: RawItem[], after?: () => void) => {
    d.db.tx(() => {
      for (const it of items) {
        const r = d.store.upsertItem(it, now);
        st.collected++;
        if (r.created) st.created++;
        if (r.mergedInto) st.merged++;
      }
      after?.();
    });
  };

  if (d.cfg.sources.github.enabled && d.github) {
    try {
      ingest(await d.github.collect(now));
    } catch (e) {
      st.sourceErrors.push(`github: ${msg(e)}`);
    }
  }
  if (d.cfg.sources.hn.enabled && d.hn) {
    try {
      const last = Number(d.store.getCursor("hn", "maxId") ?? "0");
      const { items, maxId } = await d.hn(last).collect();
      const expanded: RawItem[] = [];
      for (const it of items) expanded.push(...(await resolveGithub(it)));
      ingest(expanded, () => d.store.setCursor("hn", "maxId", String(maxId)));
    } catch (e) {
      st.sourceErrors.push(`hn: ${msg(e)}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------- refresh

/** Adaptive polling: only entities that matter (kept, or already analysed) get fresh numbers, and not more than every 2 days. */
async function refresh(d: Deps, now: Date): Promise<void> {
  if (!d.github) return;
  const cutoff = dayOf(new Date(now.getTime() - 2 * 86_400_000));
  const rows = d.db.all<{ id: string }>(
    `SELECT e.id FROM entity e
     WHERE e.id LIKE 'github:%' AND e.stage != 'dropped'
       AND (e.user_state IN ('kept','trying') OR e.stage IN ('triaged','carded'))
       AND COALESCE((SELECT MAX(day) FROM observation o WHERE o.entity_id = e.id), '') <= ?
     ORDER BY e.user_state IN ('kept','trying') DESC, e.heuristic DESC LIMIT ?`,
    cutoff,
    d.cfg.sources.github.refreshMax,
  );
  for (const r of rows) {
    try {
      const m = await d.github.refresh(r.id.slice("github:".length));
      if (m) d.store.observe(r.id, m, now);
    } catch (e) {
      if (e instanceof RateLimited) return;
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------------------------- rules / score

const obsOf = (d: Deps, id: string): Obs[] => d.store.observations(id);

function rules(d: Deps, st: RunStats, now: Date): void {
  const rows = d.db.all<EntityRow>("SELECT * FROM entity WHERE stage = 'normalized'");
  d.db.tx(() => {
    for (const e of rows) {
      const obs = obsOf(d, e.id);
      const sources = d.store.sightings(e.id).map((s) => s.source);
      const reason = applyRules(e, {
        cfg: d.cfg,
        now,
        velocity: velocity(obs, e.created_at, now),
        isHn: sources.length > 0 && sources.every((s) => s === "hn"),
      });
      if (reason) {
        d.db.run("UPDATE entity SET stage = 'dropped', drop_reason = ? WHERE id = ?", reason, e.id);
        const k = reason.split(":")[0]!;
        st.dropped[k] = (st.dropped[k] ?? 0) + 1;
      } else {
        d.db.run("UPDATE entity SET stage = 'filtered', drop_reason = NULL WHERE id = ?", e.id);
      }
    }
  });
}

function score(d: Deps, st: RunStats, now: Date): void {
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const rows = d.db.all<EntityRow>("SELECT * FROM entity WHERE stage IN ('filtered','scored','triaged','carded') AND last_seen >= ?", since);
  const bias = d.store.feedbackBias();
  d.db.tx(() => {
    for (const e of rows) {
      const h = heuristic({
        e,
        obs: obsOf(d, e.id),
        sources: new Set(d.store.sightings(e.id).map((s) => s.source)).size,
        bias,
        cfg: d.cfg,
        now,
      });
      d.db.run("UPDATE entity SET heuristic = ?, stage = CASE WHEN stage = 'filtered' THEN 'scored' ELSE stage END WHERE id = ?", h, e.id);
      st.scored++;
    }
  });
}

// ---------------------------------------------------------------------------------------------- LLM stages

function latestStars(d: Deps, id: string): number {
  const o = d.store.observations(id).at(-1);
  return o?.stars ?? o?.points ?? 0;
}

interface TriageOut {
  items: { id: string; s: number; c: string; w: string }[];
}

async function triage(d: Deps, st: RunStats, now: Date): Promise<void> {
  const cands = d.db.all<EntityRow>(
    "SELECT * FROM entity WHERE stage = 'scored' ORDER BY heuristic DESC, id LIMIT ?",
    d.cfg.funnel.triageTop,
  );
  for (let i = 0; i < cands.length; i += d.cfg.funnel.triageBatch) {
    const batch = cands.slice(i, i + d.cfg.funnel.triageBatch);
    const user = batch
      .map((e) =>
        triageLine(
          e,
          latestStars(d, e.id),
          velocity(obsOf(d, e.id), e.created_at, now),
          new Set(d.store.sightings(e.id).map((s) => s.source)).size,
          d.cfg.funnel.descriptionChars,
        ),
      )
      .join("\n");
    const out = await d.llm.call(
      { system: triageSystem(d.cfg), user, schema: triageSchema, model: d.cfg.llm.triageModel, stage: "triage", promptVersion: TRIAGE_VERSION, expectedOutTokens: 200 + batch.length * 120, effort: d.cfg.llm.triageEffort },
      now,
    );
    if (out.kind === "skipped") {
      st.degraded.push(`triage:${out.reason}`);
      return;
    }
    const byId = new Map(((out.data as TriageOut).items ?? []).map((x) => [x.id, x]));
    d.db.tx(() => {
      for (const e of batch) {
        const r = byId.get(e.id);
        if (!r || !Number.isInteger(r.s)) continue;
        const cat = (CATEGORIES as readonly string[]).includes(r.c) ? r.c : "other";
        d.db.run(
          "UPDATE entity SET stage = 'triaged', triage_score = ?, triage_cat = ?, triage_why = ?, triage_hash = content_hash WHERE id = ?",
          Math.max(0, Math.min(3, r.s)),
          cat,
          String(r.w).slice(0, 120),
          e.id,
        );
        st.triaged++;
      }
    });
  }
}

const cardCandidates = (d: Deps): EntityRow[] =>
  d.db.all<EntityRow>(
    `SELECT * FROM entity WHERE stage = 'triaged' AND triage_score >= ? AND card_json IS NULL AND user_state = 'new'
     ORDER BY triage_score DESC, heuristic DESC, id LIMIT ?`,
    d.cfg.funnel.cardMinScore,
    d.cfg.funnel.cardTop,
  );

async function enrich(d: Deps): Promise<void> {
  if (!d.github) return;
  for (const e of cardCandidates(d)) {
    if (e.body || !e.id.startsWith("github:")) continue;
    try {
      const body = await d.github.readme(e.id.slice("github:".length), d.cfg.funnel.readmeChars);
      if (body) d.db.run("UPDATE entity SET body = ? WHERE id = ?", body, e.id);
    } catch (err) {
      if (err instanceof RateLimited) return;
      throw err;
    }
  }
}

interface CardOut {
  items: { id: string; what: string; learn: string; apply: { project: string; how: string }[]; effort: string; risk: string }[];
}

async function card(d: Deps, st: RunStats, now: Date): Promise<void> {
  const cands = cardCandidates(d);
  for (let i = 0; i < cands.length; i += d.cfg.funnel.cardBatch) {
    const batch = cands.slice(i, i + d.cfg.funnel.cardBatch);
    const out = await d.llm.call(
      {
        system: cardSystem(d.cfg),
        user: batch.map((e) => cardBlock(e, d.cfg.funnel.readmeChars)).join("\n\n"),
        schema: cardSchema,
        model: d.cfg.llm.cardModel,
        stage: "card",
        promptVersion: CARD_VERSION,
        expectedOutTokens: 300 + batch.length * 350,
        effort: d.cfg.llm.cardEffort,
      },
      now,
    );
    if (out.kind === "skipped") {
      st.degraded.push(`card:${out.reason}`);
      return;
    }
    const byId = new Map(((out.data as CardOut).items ?? []).map((x) => [x.id, x]));
    d.db.tx(() => {
      for (const e of batch) {
        const c = byId.get(e.id);
        if (!c || typeof c.what !== "string") continue;
        const card = {
          what: c.what,
          learn: c.learn,
          apply: (c.apply ?? []).slice(0, 2),
          effort: ["S", "M", "L"].includes(c.effort) ? c.effort : "M",
          risk: c.risk ?? "",
        };
        d.db.run("UPDATE entity SET stage = 'carded', card_json = ?, card_hash = content_hash WHERE id = ?", JSON.stringify(card), e.id);
        st.carded++;
      }
    });
  }
}

// ---------------------------------------------------------------------------------------------- digest

function digest(d: Deps, st: RunStats, now: Date): void {
  const day = dayOf(now);
  const iso = now.toISOString();
  // Snoozed items come back when their time is up.
  d.db.run("UPDATE entity SET user_state = 'new', snooze_until = NULL WHERE user_state = 'snoozed' AND snooze_until <= ?", iso);

  const existing = d.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM digest WHERE day = ?", day)?.n ?? 0;
  if (existing > 0) {
    st.digest = existing; // same day, same digest: a re-run must not reshuffle what the user already saw
    return;
  }
  const resurfaceBefore = new Date(now.getTime() - 14 * 86_400_000).toISOString();
  const pool = d.db.all<EntityRow>(
    `SELECT * FROM entity WHERE user_state = 'new' AND stage IN ('carded','triaged','scored')
       AND (triage_score IS NULL OR triage_score >= ?)
       AND (shown_at IS NULL OR shown_at <= ?)`,
    d.cfg.funnel.cardMinScore,
    resurfaceBefore,
  );
  const ranked = pool
    .map((e) => {
      const stars = latestStars(d, e.id);
      const resurfaced = e.shown_at !== null;
      if (resurfaced && !(stars >= (e.shown_stars ?? 0) * 2 && stars - (e.shown_stars ?? 0) >= 20)) return null;
      const analysed = e.stage === "carded" ? 2 : e.stage === "triaged" ? 1 : 0;
      return { e, stars, resurfaced, rank: analysed * 100 + (e.triage_score ?? 0) * 10 + (e.heuristic ?? 0) };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.rank - a.rank || a.e.id.localeCompare(b.e.id))
    .slice(0, d.cfg.funnel.digestSize);

  d.db.tx(() => {
    ranked.forEach((r, i) => {
      const reason = r.resurfaced ? "tăng mạnh từ lần trước" : r.e.stage === "carded" ? `điểm ${r.e.triage_score}` : "chưa phân tích bằng AI";
      d.db.run("INSERT INTO digest (day, entity_id, rank, reason) VALUES (?, ?, ?, ?)", day, r.e.id, i + 1, reason);
      d.db.run("UPDATE entity SET shown_at = ?, shown_stars = ? WHERE id = ?", iso, r.stars, r.e.id);
    });
  });
  st.digest = ranked.length;
  if (ranked.some((r) => r.e.stage !== "carded") && !st.degraded.length) st.degraded.push("digest:partial");
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 160);
