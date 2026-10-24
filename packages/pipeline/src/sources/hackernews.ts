import type { Config } from "../config.js";
import type { RawItem } from "../model.js";
import { httpGet, type FetchLike } from "./http.js";

interface HnItem {
  id: number;
  type?: string;
  title?: string;
  url?: string;
  text?: string;
  by?: string;
  time?: number;
  score?: number;
  descendants?: number;
  dead?: boolean;
  deleted?: boolean;
}

const BASE = "https://hacker-news.firebaseio.com/v0";

const stripHtml = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();

export function mapHn(i: HnItem): RawItem | null {
  if (i.type !== "story" || i.dead || i.deleted || !i.title) return null;
  const title = i.title.replace(/^show hn:\s*/i, "").trim();
  const [head, ...rest] = title.split(/\s[–—-]\s/);
  const description = i.text ? stripHtml(i.text) : rest.length ? rest.join(" - ") : title;
  return {
    source: "hn",
    sourceId: String(i.id),
    url: i.url ?? `https://news.ycombinator.com/item?id=${i.id}`,
    title: head!.trim() || title,
    description,
    author: i.by,
    createdAt: i.time ? new Date(i.time * 1000).toISOString() : undefined,
    topics: ["show-hn"],
    metrics: { points: i.score ?? 0, comments: i.descendants ?? 0 },
  };
}

export class HackerNewsSource {
  readonly name = "hn";
  constructor(
    private readonly d: { cfg: Config["sources"]["hn"]; fetchImpl?: FetchLike; sleep?: (ms: number) => Promise<void>; lastMaxId: number },
  ) {}

  /** Returns new Show HN stories (id above the last one seen) and the highest id for the cursor. */
  async collect(): Promise<{ items: RawItem[]; maxId: number }> {
    const ids = (await httpGet(`${BASE}/showstories.json`, { source: "hn", fetchImpl: this.d.fetchImpl, sleep: this.d.sleep })) as number[] | null;
    const fresh = (ids ?? []).filter((id) => id > this.d.lastMaxId).slice(0, this.d.cfg.maxItems);
    const items: RawItem[] = [];
    let maxId = this.d.lastMaxId;
    for (let i = 0; i < fresh.length; i += 4) {
      const chunk = await Promise.all(
        fresh.slice(i, i + 4).map((id) => httpGet(`${BASE}/item/${id}.json`, { source: "hn", fetchImpl: this.d.fetchImpl, sleep: this.d.sleep, allow404: true })),
      );
      for (const c of chunk as (HnItem | null)[]) {
        if (!c) continue;
        maxId = Math.max(maxId, c.id);
        const m = mapHn(c);
        if (m) items.push(m);
      }
    }
    return { items, maxId };
  }
}
