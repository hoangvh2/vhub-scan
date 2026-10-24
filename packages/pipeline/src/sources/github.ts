import type { Config } from "../config.js";
import type { Metrics, RawItem } from "../model.js";
import { cleanReadme } from "../text.js";
import { httpGet, type FetchLike } from "./http.js";

interface Repo {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  topics?: string[];
  language: string | null;
  license: { spdx_id: string | null } | null;
  created_at: string;
  fork?: boolean;
  archived?: boolean;
  owner: { login: string };
}

export interface GitHubDeps {
  cfg: Config["sources"]["github"];
  token?: string;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
}

const API = "https://api.github.com";

export function mapRepo(r: Repo, fromSeed = false): RawItem {
  const lic = r.license?.spdx_id;
  return {
    source: "github",
    sourceId: r.full_name,
    url: r.html_url,
    title: r.full_name,
    description: r.description ?? "",
    author: r.owner.login,
    createdAt: r.created_at,
    topics: r.topics ?? [],
    language: r.language ?? undefined,
    license: lic && lic !== "NOASSERTION" ? lic : undefined,
    metrics: { stars: r.stargazers_count, forks: r.forks_count },
    fromSeed,
  };
}

export const expandQuery = (q: string, now: Date): string =>
  q.replace(/\{d(\d+)\}/g, (_m, n: string) => new Date(now.getTime() - Number(n) * 86_400_000).toISOString().slice(0, 10));

export class GitHubSource {
  readonly name = "github";
  constructor(private readonly d: GitHubDeps) {}

  private get<T>(path: string, allow404 = false, raw = false, accept?: string): Promise<T | null> {
    return httpGet(`${API}${path}`, {
      source: "github",
      fetchImpl: this.d.fetchImpl,
      sleep: this.d.sleep,
      allow404,
      raw,
      headers: {
        "x-github-api-version": "2022-11-28",
        ...(accept ? { accept } : { accept: "application/vnd.github+json" }),
        ...(this.d.token ? { authorization: `Bearer ${this.d.token}` } : {}),
      },
    }) as Promise<T | null>;
  }

  async collect(now: Date): Promise<RawItem[]> {
    const out: RawItem[] = [];
    const pause = this.d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    for (const q of this.d.cfg.queries) {
      const res = await this.get<{ items: Repo[] }>(
        `/search/repositories?q=${encodeURIComponent(expandQuery(q, now))}&sort=stars&order=desc&per_page=${this.d.cfg.perQuery}`,
      );
      for (const r of res?.items ?? []) if (!r.fork && !r.archived) out.push(mapRepo(r));
      await pause(this.d.token ? 2_100 : 6_100); // search allows 30/min with a token, 10/min without
    }
    for (const login of this.d.cfg.seeds) {
      const repos = await this.get<Repo[]>(`/users/${encodeURIComponent(login)}/repos?sort=created&direction=desc&per_page=10`, true);
      for (const r of repos ?? []) if (!r.fork && !r.archived) out.push(mapRepo(r, true));
    }
    return out;
  }

  /** One repo, used to fill in a GitHub link found elsewhere (for example a Show HN post). */
  async repo(fullName: string): Promise<RawItem | null> {
    const r = await this.get<Repo>(`/repos/${fullName}`, true);
    return r ? mapRepo(r) : null;
  }

  async refresh(fullName: string): Promise<Metrics | null> {
    const r = await this.get<Repo>(`/repos/${fullName}`, true);
    return r ? { stars: r.stargazers_count, forks: r.forks_count } : null;
  }

  async readme(fullName: string, maxChars: number): Promise<string | null> {
    const t = await this.get<string>(`/repos/${fullName}/readme`, true, true, "application/vnd.github.raw+json");
    return t ? cleanReadme(t, maxChars) : null;
  }
}
