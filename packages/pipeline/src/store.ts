import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { canonicalKey } from "./canonical.js";
import { dayOf, type EntityRow, type Metrics, type RawItem, type UserAction, type UserState } from "./model.js";
import { fromHex, hamming, SimIndex, simhash, toHex } from "./simhash.js";
import { jaccard, sha256, tokens } from "./text.js";

export interface UpsertResult {
  id: string;
  created: boolean;
  /** Set when a new item was folded into an existing entity as a near-duplicate. */
  mergedInto?: string;
}

/** Entity key for a raw item. A Show HN post that points at a GitHub repo is that repo. */
export function entityKey(item: RawItem): string {
  if (item.source === "github") return `github:${item.sourceId.toLowerCase()}`;
  if (item.source === "hn" && !item.url) return `hn:${item.sourceId}`;
  if (item.source === "hn" && item.url.includes("news.ycombinator.com")) return `hn:${item.sourceId}`;
  return canonicalKey(item.url);
}

/** Repo name without the owner, as tokens: "acme/TaskFlow" and "TaskFlow" compare equal. */
export const nameTokens = (title: string): string[] => tokens(title.split("/").pop() ?? title);

/** The description is what copies share; the title is only used to double-check a candidate. */
const simText = (title: string, description: string): string => (tokens(description).length >= 6 ? description : `${title} ${description}`);

export class Store {
  private index: SimIndex;
  private titles = new Map<string, string[]>();

  constructor(
    readonly db: Db,
    private readonly cfg: Config,
  ) {
    this.index = new SimIndex();
    for (const r of db.all<{ id: string; simhash: string; title: string }>(
      "SELECT id, simhash, title FROM entity WHERE simhash IS NOT NULL AND merged_into IS NULL",
    )) {
      this.index.add(r.id, fromHex(r.simhash));
      this.titles.set(r.id, nameTokens(r.title));
    }
  }

  // ------------------------------------------------------------------ ingest

  upsertItem(item: RawItem, now: Date): UpsertResult {
    const key = entityKey(item);
    const alias = this.db.get<{ entity_id: string }>("SELECT entity_id FROM alias WHERE key = ?", key);
    const existingId = alias?.entity_id ?? (this.db.get<{ id: string }>("SELECT id FROM entity WHERE id = ?", key)?.id ?? null);
    const iso = now.toISOString();
        const contentHash = sha256(`${item.title}\n${item.description}\n${[...item.topics].sort().join(",")}`);

    if (existingId) {
      // Reached through an alias (a copy that was folded in): record the sighting only. Its text and its numbers
      // are the copy's, not the entity's, and must not overwrite them.
      if (alias) {
        this.db.run("UPDATE entity SET last_seen = ? WHERE id = ?", iso, existingId);
        this.addSighting(existingId, item, iso);
        return { id: existingId, created: false };
      }
      this.touch(existingId, item, contentHash, iso);
      this.addSighting(existingId, item, iso);
      this.observe(existingId, item.metrics, now);
      return { id: existingId, created: false };
    }

    const sh = simhash(simText(item.title, item.description));
    if (sh !== null) {
      const tt = nameTokens(item.title);
      for (const cand of this.index.nearest(sh, this.cfg.dedupe.hammingMax)) {
        if (jaccard(tt, this.titles.get(cand.id) ?? []) >= this.cfg.dedupe.titleJaccardMin) {
          this.db.run("INSERT OR REPLACE INTO alias(key, entity_id) VALUES (?, ?)", key, cand.id);
          this.addSighting(cand.id, item, iso);
          this.db.run("UPDATE entity SET last_seen = ? WHERE id = ?", iso, cand.id);
          return { id: cand.id, created: false, mergedInto: cand.id };
        }
      }
    }

    this.db.run(
      `INSERT INTO entity (id, title, description, url, author, language, license, topics, created_at, first_seen, last_seen,
                           simhash, content_hash, from_seed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      key,
      item.title,
      item.description,
      item.url,
      item.author ?? null,
      item.language ?? null,
      item.license ?? null,
      JSON.stringify(item.topics),
      item.createdAt ?? null,
      iso,
      iso,
      sh === null ? null : toHex(sh),
      contentHash,
      item.fromSeed ? 1 : 0,
    );
    if (sh !== null) {
      this.index.add(key, sh);
      this.titles.set(key, nameTokens(item.title));
    }
    this.addSighting(key, item, iso);
    this.observe(key, item.metrics, now);
    return { id: key, created: true };
  }

  private touch(id: string, item: RawItem, contentHash: string | null, iso: string): void {
    this.db.run("UPDATE entity SET last_seen = ? WHERE id = ?", iso, id);
    if (item.fromSeed) this.db.run("UPDATE entity SET from_seed = 1 WHERE id = ?", id);
    // Only GitHub (or the entity's own source) may rewrite the text: a Show HN post about a repo must not replace the repo's description.
    if (contentHash && (item.source === "github" || !id.startsWith("github:"))) {
      const cur = this.db.get<{ content_hash: string }>("SELECT content_hash FROM entity WHERE id = ?", id);
      if (cur && cur.content_hash !== contentHash) {
        // Text changed: re-run the rules and triage (the LLM cache still spares unchanged payloads).
        this.db.run(
          `UPDATE entity SET title = ?, description = ?, topics = ?, content_hash = ?,
             stage = CASE WHEN stage = 'dropped' THEN stage ELSE 'normalized' END WHERE id = ?`,
          item.title,
          item.description,
          JSON.stringify(item.topics),
          contentHash,
          id,
        );
      }
    }
  }

  private addSighting(id: string, item: RawItem, iso: string): void {
    this.db.run(
      `INSERT INTO sighting (entity_id, source, source_id, url, first_seen, last_seen, metrics) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(entity_id, source, source_id) DO UPDATE SET last_seen = excluded.last_seen, metrics = excluded.metrics, url = excluded.url`,
      id,
      item.source,
      item.sourceId,
      item.url,
      iso,
      iso,
      JSON.stringify(item.metrics),
    );
  }

  /** One observation per entity per day: a re-run on the same day replaces instead of duplicating. */
  observe(id: string, m: Metrics, now: Date): void {
    const day = dayOf(now);
    const prev = this.db.get<{ stars: number | null; forks: number | null; points: number | null; comments: number | null }>(
      "SELECT stars, forks, points, comments FROM observation WHERE entity_id = ? AND day = ?",
      id,
      day,
    );
    const pick = (a: number | undefined, b: number | null | undefined) => (a !== undefined ? a : (b ?? null));
    this.db.run(
      "INSERT OR REPLACE INTO observation (entity_id, day, stars, forks, points, comments) VALUES (?, ?, ?, ?, ?, ?)",
      id,
      day,
      pick(m.stars, prev?.stars),
      pick(m.forks, prev?.forks),
      pick(m.points, prev?.points),
      pick(m.comments, prev?.comments),
    );
  }

  // ------------------------------------------------------------------ queries

  entity(id: string): EntityRow | undefined {
    return this.db.get<EntityRow>("SELECT * FROM entity WHERE id = ?", id);
  }

  observations(id: string): { day: string; stars: number | null; forks: number | null; points: number | null; comments: number | null }[] {
    return this.db.all("SELECT day, stars, forks, points, comments FROM observation WHERE entity_id = ? ORDER BY day", id);
  }

  sightings(id: string): { source: string; source_id: string; url: string; first_seen: string; last_seen: string; metrics: string }[] {
    return this.db.all("SELECT source, source_id, url, first_seen, last_seen, metrics FROM sighting WHERE entity_id = ? ORDER BY first_seen", id);
  }

  getCursor(source: string, key: string): string | null {
    return this.db.get<{ value: string }>("SELECT value FROM cursor WHERE source = ? AND key = ?", source, key)?.value ?? null;
  }
  setCursor(source: string, key: string, value: string): void {
    this.db.run("INSERT OR REPLACE INTO cursor(source, key, value) VALUES (?, ?, ?)", source, key, value);
  }

  // ------------------------------------------------------------------ feedback

  applyFeedback(id: string, action: UserAction, now: Date, snoozeDays = 7): boolean {
    const e = this.entity(id);
    if (!e) return false;
    const state: UserState =
      action === "keep" ? "kept" : action === "skip" ? "skipped" : action === "snooze" ? "snoozed" : action === "trying" ? "trying" : action === "done" ? "done" : "new";
    const until = action === "snooze" ? new Date(now.getTime() + snoozeDays * 86_400_000).toISOString() : null;
    this.db.tx(() => {
      this.db.run("UPDATE entity SET user_state = ?, snooze_until = ? WHERE id = ?", state, until, id);
      this.db.run("INSERT INTO feedback (entity_id, action, at) VALUES (?, ?, ?)", id, action, now.toISOString());
    });
    return true;
  }

  /** Per-keyword log-odds of Keep versus Skip, learned from the user's own feedback. */
  feedbackBias(): Map<string, number> {
    const counts = new Map<string, { keep: number; skip: number }>();
    const rows = this.db.all<{ action: string; topics: string; title: string }>(
      `SELECT f.action, e.topics, e.title FROM feedback f JOIN entity e ON e.id = f.entity_id
       WHERE f.action IN ('keep','trying','done','skip')`,
    );
    for (const r of rows) {
      const words = new Set<string>([...(JSON.parse(r.topics) as string[]).map((t) => t.toLowerCase()), ...tokens(r.title)]);
      const keep = r.action !== "skip";
      for (const w of words) {
        const c = counts.get(w) ?? { keep: 0, skip: 0 };
        if (keep) c.keep++;
        else c.skip++;
        counts.set(w, c);
      }
    }
    const out = new Map<string, number>();
    for (const [w, c] of counts) out.set(w, Math.log((c.keep + 1) / (c.skip + 1)));
    return out;
  }

  /** For tests and diagnostics: a stable snapshot of everything a run is supposed to decide. */
  snapshot(): unknown {
    return {
      entities: this.db.all(
        `SELECT id, title, stage, drop_reason, merged_into, round(heuristic, 6) AS heuristic, triage_score, triage_cat, triage_why,
                card_json, user_state, shown_at IS NOT NULL AS shown FROM entity ORDER BY id`,
      ),
      aliases: this.db.all("SELECT key, entity_id FROM alias ORDER BY key"),
      digest: this.db.all("SELECT day, entity_id, rank FROM digest ORDER BY day, rank"),
    };
  }

  hammingBetween(a: string, b: string): number | null {
    const x = this.entity(a)?.simhash;
    const y = this.entity(b)?.simhash;
    return x && y ? hamming(fromHex(x), fromHex(y)) : null;
  }
}
