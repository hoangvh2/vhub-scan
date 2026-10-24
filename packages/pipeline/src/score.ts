import type { Config } from "./config.js";
import type { EntityRow } from "./model.js";
import { hasTerm, textOf } from "./rules.js";
import { tokens } from "./text.js";

export interface Obs {
  day: string;
  stars: number | null;
  points: number | null;
}

const val = (o: Obs): number => o.stars ?? o.points ?? 0;

/** Gain per day between the last two observations; before there are two, popularity over age. */
export function velocity(obs: Obs[], createdAt: string | null, now: Date): number {
  if (obs.length >= 2) {
    const a = obs[obs.length - 2]!;
    const b = obs[obs.length - 1]!;
    const days = Math.max(1, (Date.parse(b.day) - Date.parse(a.day)) / 86_400_000);
    return Math.max(0, (val(b) - val(a)) / days);
  }
  const last = obs[obs.length - 1];
  if (!last) return 0;
  const age = createdAt ? Math.max(1, (now.getTime() - Date.parse(createdAt)) / 86_400_000) : 30;
  return val(last) / age;
}

export interface ScoreInput {
  e: EntityRow;
  obs: Obs[];
  sources: number;
  bias: Map<string, number>;
  cfg: Config;
  now: Date;
}

/** Heuristic score, roughly 0..8. Deterministic and explainable; the LLM only sees the top of this ranking. */
export function heuristic({ e, obs, sources, bias, cfg, now }: ScoreInput): number {
  const v = velocity(obs, e.created_at, now);
  const last = obs[obs.length - 1];
  const pop = Math.log10(1 + (last ? val(last) : 0));
  const velScore = Math.log1p(v) * 1.2;
  const age = e.created_at ? Math.max(0, (now.getTime() - Date.parse(e.created_at)) / 86_400_000) : 30;
  const recency = age <= 7 ? 1 : age <= 30 ? 0.5 : 0;
  const hay = textOf(e);
  const hits = cfg.scope.include.filter((w) => hasTerm(hay, w)).length;
  const fit = Math.min(3, hits) * 0.5;
  const seed = e.from_seed ? 1 : 0;
  const multi = Math.min(1.5, (sources - 1) * 0.5);
  let fb = 0;
  for (const w of new Set([...(JSON.parse(e.topics) as string[]).map((t) => t.toLowerCase()), ...tokens(e.title)])) {
    fb += (bias.get(w) ?? 0) * 0.3;
  }
  fb = Math.max(-1, Math.min(1, fb));
  return pop + velScore + recency + fit + seed + multi + fb;
}
