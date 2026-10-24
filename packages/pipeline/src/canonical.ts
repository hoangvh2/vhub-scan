/**
 * Canonical entity keys. Two sightings with the same key are the same thing; this is the exact-match
 * layer of deduplication and costs no tokens.
 */
const TRACKING = /^(utm_|fbclid$|gclid$|ref$|ref_src$|source$|mc_|igshid$|si$)/i;

export function unwrapRedirect(raw: string): string {
  try {
    const u = new URL(raw);
    if (/^(l|lm)\.facebook\.com$/.test(u.hostname) && u.pathname.startsWith("/l.php")) {
      const target = u.searchParams.get("u");
      if (target) return target; // decoded locally; Facebook is never contacted
    }
    if (u.hostname === "www.google.com" && u.pathname === "/url") {
      const target = u.searchParams.get("q") ?? u.searchParams.get("url");
      if (target) return target;
    }
  } catch {
    /* not a URL */
  }
  return raw;
}

export function canonicalKey(rawUrl: string): string {
  const unwrapped = unwrapRedirect(rawUrl.trim());
  let u: URL;
  try {
    u = new URL(unwrapped);
  } catch {
    return `raw:${unwrapped.toLowerCase()}`;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const path = u.pathname.replace(/\/+$/, "");

  if (host === "github.com") {
    const m = /^\/([^/]+)\/([^/]+)/.exec(path);
    if (m) return `github:${m[1]!.toLowerCase()}/${m[2]!.replace(/\.git$/i, "").toLowerCase()}`;
  }
  if (host === "news.ycombinator.com" && path === "/item") {
    const id = u.searchParams.get("id");
    if (id) return `hn:${id}`;
  }
  if (host === "producthunt.com") {
    const m = /^\/(?:posts|products)\/([^/]+)/.exec(path);
    if (m) return `ph:${m[1]!.toLowerCase()}`;
  }
  if (host === "play.google.com") {
    const id = u.searchParams.get("id");
    if (id) return `play:${id.toLowerCase()}`;
  }
  if (host === "apps.apple.com") {
    const m = /\/id(\d+)/.exec(path);
    if (m) return `appstore:${m[1]}`;
  }
  const keep = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
  const q = keep.length ? "?" + keep.map(([k, v]) => `${k}=${v}`).join("&") : "";
  return `url:${host}${path}${q}`;
}
