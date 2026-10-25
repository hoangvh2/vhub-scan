import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "./db.js";
import type { Budget } from "./llm/budget.js";
import { USER_ACTIONS, systemClock, type Clock, type UserAction } from "./model.js";
import type { Store } from "./store.js";
import { buildSnapshot } from "./snapshot.js";
import { recheckRules } from "./pipeline.js";
import { rulesFingerprint } from "./rules.js";
import { applyPatch, estimateRun } from "./settings.js";
import type { SettingsStore } from "./settingsStore.js";
import { digestFor, health, listEntities, toView } from "./views.js";

export interface ServerOptions {
  db: Db;
  store: Store;
  budget: Budget;
  token: string;
  clock?: Clock;
  /** Starts a pipeline run in the background; resolves when it has been started (not finished). */
  runNow?: () => Promise<{ started: boolean; reason?: string }>;
  webDir?: string;
  /** Extra fields for /api/health (sync status). */
  extraHealth?: () => Record<string, unknown>;
  /** The settings page. Absent: /api/settings answers 501. */
  settings?: SettingsStore;
  /** Runs one GitHub search for the settings page's "Thử" button (uses the network and the GitHub quota). */
  testQuery?: (q: string) => Promise<{ total: number; items: { name: string; stars: number; description: string }[] }>;
  /** Result of the last change sent from the phone or the hosted page (cloud sync records it). */
  remoteSettings?: () => unknown;
}

const here = dirname(fileURLToPath(import.meta.url));

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
  "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

function send(res: ServerResponse, status: number, body: unknown, type = "application/json; charset=utf-8"): void {
  res.writeHead(status, { ...SECURITY_HEADERS, "content-type": type });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function authorised(req: IncomingMessage, url: URL, token: string): boolean {
  const given = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "") || url.searchParams.get("t") || "";
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readJson(req: IncomingMessage, limit = 16_384): Promise<unknown> {
  let n = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > limit) throw new Error("body too large");
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export function createApp(o: ServerOptions): Server {
  const clock = o.clock ?? systemClock;
  const webDir = o.webDir ?? join(here, "..", "web");
  const dirs = [webDir, join(here, "web")];
  const page = (): string => {
    for (const d of dirs) {
      try {
        return readFileSync(join(d, "index.html"), "utf8");
      } catch {
        /* try the next location */
      }
    }
    return "<h1>Dashboard not found</h1>";
  };

  return createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (req.method === "GET" && url.pathname === "/") return send(res, 200, page(), "text/html; charset=utf-8");
        if (!url.pathname.startsWith("/api/")) return send(res, 404, { error: "not found" });
        if (!authorised(req, url, o.token)) return send(res, 401, { error: "unauthorised" });

        if (req.method === "GET" && url.pathname === "/api/health") {
          const categories = o.settings ? o.settings.view().categories : undefined;
          return send(res, 200, { ...(health(o.db, o.budget, clock.now()) as object), categories, ...(o.extraHealth?.() ?? {}) });
        }
        if (url.pathname.startsWith("/api/settings")) {
          const st = o.settings;
          if (!st) return send(res, 501, { error: "not available" });
          const page = (view: ReturnType<SettingsStore["view"]>) => ({ ...view, history: st.history(), file: st.configFile, remote: o.remoteSettings?.() ?? null, canTestQuery: !!o.testQuery });
          if (req.method === "GET" && url.pathname === "/api/settings") return send(res, 200, page(st.view()));
          if (req.method === "POST" && url.pathname === "/api/settings") {
            const b = (await readJson(req, 65_536)) as { patch?: unknown; baseRev?: unknown };
            const r = st.save(b.patch, { source: "pc", origin: "local", baseRev: typeof b.baseRev === "string" ? b.baseRev : undefined });
            return send(res, r.ok ? 200 : "conflict" in r && r.conflict ? 409 : 400, { ...r, view: page(r.view) });
          }
          if (req.method === "POST" && url.pathname === "/api/settings/preview") {
            const b = (await readJson(req, 65_536)) as { patch?: unknown };
            const cur = st.load();
            const r = applyPatch(cur, b.patch, "local");
            if (r.errors.length) return send(res, 400, { errors: r.errors });
            const recheck = rulesFingerprint(cur) === rulesFingerprint(r.config) ? { dropped: 0, revived: 0 } : recheckRules(o, r.config, clock.now(), true);
            return send(res, 200, { changed: r.changed, before: estimateRun(cur), after: estimateRun(r.config), recheck });
          }
          if (req.method === "POST" && url.pathname === "/api/settings/restore") {
            const b = (await readJson(req)) as { id?: unknown };
            const r = st.restore(typeof b.id === "string" ? b.id : "");
            return send(res, r.ok ? 200 : 400, { ...r, view: page(r.view) });
          }
          if (req.method === "POST" && url.pathname === "/api/settings/test-query") {
            if (!o.testQuery) return send(res, 501, { error: "not available" });
            const b = (await readJson(req)) as { query?: unknown };
            const q = typeof b.query === "string" ? b.query.trim() : "";
            if (!q || q.length > 200) return send(res, 400, { error: "query từ 1 đến 200 ký tự" });
            try {
              return send(res, 200, await o.testQuery(q));
            } catch (e) {
              return send(res, 502, { error: e instanceof Error ? e.message.slice(0, 160) : "GitHub lỗi" });
            }
          }
          return send(res, 404, { error: "not found" });
        }
        // The full snapshot as published to the cloud; handy for debugging and for regenerating the app's screenshot fixture.
        if (req.method === "GET" && url.pathname === "/api/snapshot") return send(res, 200, buildSnapshot(o.db, o.store, o.budget, clock.now(), { maxBytes: Infinity, settings: o.settings ? { ...o.settings.view(), remote: (o.remoteSettings?.() ?? null) as never } : undefined }));
        if (req.method === "GET" && url.pathname === "/api/digest") return send(res, 200, digestFor(o.db, o.store, url.searchParams.get("day") ?? undefined));
        if (req.method === "GET" && url.pathname === "/api/entities") {
          return send(res, 200, {
            items: listEntities(o.db, o.store, {
              state: url.searchParams.get("state") ?? undefined,
              q: url.searchParams.get("q") ?? undefined,
              cat: url.searchParams.get("cat") ?? undefined,
              limit: Number(url.searchParams.get("limit") ?? 50) || 50,
            }),
          });
        }
        if (req.method === "GET" && url.pathname === "/api/entity") {
          const e = o.store.entity(url.searchParams.get("id") ?? "");
          if (!e) return send(res, 404, { error: "not found" });
          return send(res, 200, { ...toView(o.store, e), observations: o.store.observations(e.id), sightings: o.store.sightings(e.id) });
        }
        if (req.method === "POST" && url.pathname === "/api/feedback") {
          const b = (await readJson(req)) as { id?: string; action?: string; days?: number };
          if (typeof b.id !== "string" || !(USER_ACTIONS as readonly string[]).includes(b.action ?? "")) return send(res, 400, { error: "bad request" });
          const ok = o.store.applyFeedback(b.id, b.action as UserAction, clock.now(), Math.max(1, Math.min(90, Number(b.days) || 7)));
          return send(res, ok ? 200 : 404, { ok });
        }
        if (req.method === "POST" && url.pathname === "/api/run") {
          if (!o.runNow) return send(res, 501, { error: "not available" });
          const r = await o.runNow();
          return send(res, r.started ? 202 : 409, r);
        }
        return send(res, 404, { error: "not found" });
      } catch (e) {
        send(res, 400, { error: e instanceof Error ? e.message.slice(0, 120) : "error" });
      }
    })();
  });
}
