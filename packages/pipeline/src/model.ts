export type SourceName = "github" | "hn" | "share";

export interface Metrics {
  stars?: number;
  forks?: number;
  points?: number;
  comments?: number;
}

/** What a connector returns. Everything else is derived from it. */
export interface RawItem {
  source: SourceName;
  /** Stable id inside the source (owner/repo, HN item id, ...). */
  sourceId: string;
  url: string;
  title: string;
  description: string;
  author?: string;
  createdAt?: string;
  topics: string[];
  language?: string;
  license?: string;
  metrics: Metrics;
  /** Set when the author is on the user's watch list. */
  fromSeed?: boolean;
}

export type UserState = "new" | "kept" | "skipped" | "snoozed" | "trying" | "done";
export const USER_ACTIONS = ["keep", "skip", "snooze", "trying", "done", "reset"] as const;
export type UserAction = (typeof USER_ACTIONS)[number];

export type Stage = "normalized" | "filtered" | "scored" | "triaged" | "carded" | "dropped";

export interface Card {
  what: string;
  learn: string;
  apply: { project: string; how: string }[];
  effort: "S" | "M" | "L";
  risk: string;
}

export interface EntityRow {
  id: string;
  title: string;
  description: string;
  url: string;
  author: string | null;
  language: string | null;
  license: string | null;
  topics: string; // JSON string[]
  body: string | null;
  created_at: string | null;
  first_seen: string;
  last_seen: string;
  simhash: string;
  merged_into: string | null;
  stage: Stage;
  drop_reason: string | null;
  content_hash: string;
  from_seed: number;
  heuristic: number | null;
  triage_score: number | null;
  triage_cat: string | null;
  triage_why: string | null;
  card_json: string | null;
  card_hash: string | null;
  user_state: UserState;
  snooze_until: string | null;
  shown_at: string | null;
  shown_stars: number | null;
}

export interface Clock {
  now(): Date;
}
export const systemClock: Clock = { now: () => new Date() };

export const dayOf = (d: Date): string => d.toISOString().slice(0, 10);
