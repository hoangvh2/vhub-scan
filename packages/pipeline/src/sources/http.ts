export type FetchLike = typeof fetch;

export class RateLimited extends Error {
  constructor(readonly source: string) {
    super(`${source}: rate limit reached`);
    this.name = "RateLimited";
  }
}

export interface HttpOptions {
  fetchImpl?: FetchLike;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
  source: string;
  /** Return null instead of throwing on 404. */
  allow404?: boolean;
  raw?: boolean;
}

const nap = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** GET with a timeout, a User-Agent, and bounded retries on 429/5xx. Never logs headers (they can hold tokens). */
export async function httpGet(url: string, o: HttpOptions): Promise<unknown | null> {
  const f = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? nap;
  const retries = o.retries ?? 2;
  let lastStatus = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(500 * 2 ** attempt);
    const res = await f(url, {
      headers: { "user-agent": "vhub-trend-scan/0.1 (+personal use)", accept: "application/json", ...o.headers },
      signal: AbortSignal.timeout(o.timeoutMs ?? 20_000),
    });
    if (res.ok) return o.raw ? await res.text() : await res.json();
    lastStatus = res.status;
    if (res.status === 404 && o.allow404) return null;
    if ((res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0") throw new RateLimited(o.source);
    if (res.status === 429 || res.status >= 500) continue;
    break;
  }
  throw new Error(`${o.source}: HTTP ${lastStatus} for ${new URL(url).pathname}`);
}
