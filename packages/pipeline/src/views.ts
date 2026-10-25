import type { Db } from "./db.js";
import type { Budget } from "./llm/budget.js";
import { dayOf, type Card, type EntityRow } from "./model.js";
import type { Store } from "./store.js";

export interface EntityView {
  id: string;
  title: string;
  description: string;
  url: string;
  author: string | null;
  license: string | null;
  topics: string[];
  stage: string;
  userState: string;
  triage: { score: number | null; cat: string | null; why: string | null };
  heuristic: number | null;
  card: Card | null;
  stars: number | null;
  points: number | null;
  sources: string[];
  firstSeen: string;
  shownAt: string | null;
  shownReason?: string;
}

export function toView(store: Store, e: EntityRow): EntityView {
  const last = store.observations(e.id).at(-1);
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    url: e.url,
    author: e.author,
    license: e.license,
    topics: JSON.parse(e.topics) as string[],
    stage: e.stage,
    userState: e.user_state,
    triage: { score: e.triage_score, cat: e.triage_cat, why: e.triage_why },
    heuristic: e.heuristic,
    card: e.card_json ? (JSON.parse(e.card_json) as Card) : null,
    stars: last?.stars ?? null,
    points: last?.points ?? null,
    sources: [...new Set(store.sightings(e.id).map((s) => s.source))],
    firstSeen: e.first_seen,
    shownAt: e.shown_at,
  };
}

export function digestFor(db: Db, store: Store, day?: string): { day: string | null; items: EntityView[] } {
  const d = day ?? db.get<{ day: string }>("SELECT MAX(day) AS day FROM digest")?.day ?? null;
  if (!d) return { day: null, items: [] };
  const rows = db.all<{ entity_id: string; reason: string }>("SELECT entity_id, reason FROM digest WHERE day = ? ORDER BY rank", d);
  const items: EntityView[] = [];
  for (const r of rows) {
    const e = store.entity(r.entity_id);
    if (e) items.push({ ...toView(store, e), shownReason: r.reason });
  }
  return { day: d, items };
}

export function listEntities(db: Db, store: Store, o: { state?: string; q?: string; cat?: string; limit?: number }): EntityView[] {
  const where: string[] = ["stage != 'dropped'"];
  const p: (string | number)[] = [];
  if (o.state) {
    where.push("user_state = ?");
    p.push(o.state);
  }
  if (o.cat) {
    where.push("triage_cat = ?");
    p.push(o.cat);
  }
  if (o.q) {
    where.push("(title LIKE ? OR description LIKE ? OR topics LIKE ?)");
    const like = `%${o.q.replace(/[%_]/g, "")}%`;
    p.push(like, like, like);
  }
  p.push(Math.min(200, o.limit ?? 50));
  const rows = db.all<EntityRow>(
    `SELECT * FROM entity WHERE ${where.join(" AND ")} ORDER BY COALESCE(triage_score, 0) DESC, COALESCE(heuristic, 0) DESC, id LIMIT ?`,
    ...p,
  );
  return rows.map((e) => toView(store, e));
}

export function health(db: Db, budget: Budget, now: Date): unknown {
  const run = db.get<{ id: string; started_at: string; finished_at: string | null; status: string; stage: string; stats: string; error: string | null }>(
    "SELECT id, started_at, finished_at, status, stage, stats, error FROM run ORDER BY started_at DESC LIMIT 1",
  );
  const counts = Object.fromEntries(
    db.all<{ stage: string; n: number }>("SELECT stage, COUNT(*) AS n FROM entity GROUP BY stage").map((r) => [r.stage, r.n]),
  );
  const states = Object.fromEntries(
    db.all<{ user_state: string; n: number }>("SELECT user_state, COUNT(*) AS n FROM entity WHERE stage != 'dropped' GROUP BY user_state").map((r) => [r.user_state, r.n]),
  );
  const drops = db.all<{ reason: string; n: number }>(
    "SELECT substr(drop_reason, 1, instr(drop_reason || ':', ':') - 1) AS reason, COUNT(*) AS n FROM entity WHERE stage = 'dropped' GROUP BY 1 ORDER BY n DESC",
  );
  return {
    day: dayOf(now),
    lastRun: run ? { ...run, stats: JSON.parse(run.stats) as unknown } : null,
    tokens: budget.today(now),
    entities: counts,
    userStates: states,
    dropReasons: drops,
  };
}
