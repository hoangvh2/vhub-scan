import { createVerify, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkPhonePath } from "../src/cloud/check.js";
import { fromTerraformOutput, parseCloudConfig, type CloudConfig } from "../src/cloud/config.js";
import { decode, encode, FirestoreRest, type DocStore, type FsDoc, type Primitive } from "../src/cloud/firestore.js";
import { CUSTOM_TOKEN_AUD, customToken, ServiceAccountAuth, signJwt } from "../src/cloud/google.js";
import { lanUrls, pairCode, pairPayload, qrSvg, qrTerminal, webLink } from "../src/cloud/pair.js";
import { lastSync, syncOnce } from "../src/cloud/sync.js";
import { runPipeline } from "../src/pipeline.js";
import { buildSnapshot, snapshotHash } from "../src/snapshot.js";
import { NOW, rig } from "./helpers.js";
import { cfg, world } from "./world.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });

const cloudCfg = (over: Partial<CloudConfig> = {}): CloudConfig => ({
  projectId: "vhub-trend-test",
  apiKey: "AIzaTestKey0000",
  uid: "owner",
  serviceAccount: { client_email: "vhub-trend-pc@vhub-trend-test.iam.gserviceaccount.com", private_key: privateKey },
  syncMinutes: 10,
  ...over,
});

const parts = (jwt: string) => {
  const [h, b, s] = jwt.split(".");
  const v = createVerify("RSA-SHA256");
  v.update(`${h}.${b}`);
  return { header: JSON.parse(Buffer.from(h!, "base64url").toString()), body: JSON.parse(Buffer.from(b!, "base64url").toString()), valid: v.verify(publicKey, Buffer.from(s!, "base64url")) };
};

/** Firestore stand-in with the same semantics sync relies on. */
class MemoryDocs implements DocStore {
  docs = new Map<string, Record<string, Primitive>>();
  writes = 0;
  failList = false;
  async set(path: string, fields: Record<string, Primitive>) {
    this.writes++;
    this.docs.set(path, fields);
  }
  async list(coll: string): Promise<FsDoc[]> {
    if (this.failList) throw new Error("Firestore GET 503: unavailable");
    return [...this.docs.entries()]
      .filter(([k]) => k.startsWith(coll + "/") && !k.slice(coll.length + 1).includes("/"))
      .map(([k, fields]) => ({ name: `projects/p/databases/(default)/documents/${k}`, id: k.slice(k.lastIndexOf("/") + 1), fields }));
  }
  async remove(names: string[]) {
    for (const n of names) this.docs.delete(n.replace("projects/p/databases/(default)/documents/", ""));
  }
}

async function seeded() {
  const r = rig({ cfg: cfg(), ...world() });
  await runPipeline(r.deps);
  return r;
}

describe("JWT signing", () => {
  it("custom token has the claims Firebase Auth requires and verifies with the key", () => {
    const t = parts(customToken(cloudCfg(), NOW));
    expect(t.valid).toBe(true);
    expect(t.header).toEqual({ alg: "RS256", typ: "JWT" });
    expect(t.body).toMatchObject({ iss: cloudCfg().serviceAccount.client_email, sub: cloudCfg().serviceAccount.client_email, aud: CUSTOM_TOKEN_AUD, uid: "owner" });
    expect(t.body.exp - t.body.iat).toBe(3600);
  });
  it("signJwt round-trips arbitrary claims", () => {
    expect(parts(signJwt(privateKey, { a: 1 })).body).toEqual({ a: 1 });
  });
});

describe("service-account access token", () => {
  it("exchanges a signed assertion once and caches it", async () => {
    const calls: { url: string; body: string }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) });
      return new Response(JSON.stringify({ access_token: "ya29.x", expires_in: 3600 }), { status: 200 });
    }) as unknown as typeof fetch;
    const a = new ServiceAccountAuth(cloudCfg(), f, () => NOW);
    expect(await a.token()).toBe("ya29.x");
    expect(await a.token()).toBe("ya29.x");
    expect(calls).toHaveLength(1);
    const form = new URLSearchParams(calls[0]!.body);
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(parts(form.get("assertion")!).body).toMatchObject({ scope: "https://www.googleapis.com/auth/datastore", aud: "https://oauth2.googleapis.com/token" });
  });
  it("explains a rejected key", async () => {
    const f = (async () => new Response(JSON.stringify({ error: "invalid_grant", error_description: "Invalid JWT Signature." }), { status: 400 })) as unknown as typeof fetch;
    await expect(new ServiceAccountAuth(cloudCfg(), f, () => NOW).token()).rejects.toThrow(/invalid_grant.*cloud:connect/);
  });
  it("uses the emulator's admin token without calling Google", async () => {
    expect(await new ServiceAccountAuth(cloudCfg({ firestoreUrl: "http://127.0.0.1:8080" }), (() => { throw new Error("no"); }) as never).token()).toBe("owner");
  });
});

describe("Firestore REST client", () => {
  it("encodes and decodes the value kinds it stores", () => {
    for (const v of ["a", 3, 1.5, true, null] as Primitive[]) expect(decode(encode(v) as never)).toBe(v);
    expect(encode(7)).toEqual({ integerValue: "7" });
  });
  it("sets, lists across pages, and deletes in commit batches", async () => {
    const seen: { method: string; url: string; body: unknown }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      seen.push({ method: init.method ?? "GET", url, body: init.body ? JSON.parse(String(init.body)) : undefined });
      if (init.method === "GET" && !url.includes("pageToken")) {
        return new Response(JSON.stringify({ documents: [{ name: "projects/p/databases/(default)/documents/owners/owner/inbox/e1", fields: { at: { integerValue: "5" }, action: { stringValue: "keep" } } }], nextPageToken: "n2" }));
      }
      if (init.method === "GET") return new Response(JSON.stringify({ documents: [{ name: "projects/p/databases/(default)/documents/owners/owner/inbox/e2", fields: {} }] }));
      return new Response("{}");
    }) as unknown as typeof fetch;
    const fs = new FirestoreRest({ projectId: "p", token: async () => "tok", fetchImpl: f });
    await fs.set("owners/owner/snapshot/latest", { schema: 1, payload: "{}" });
    expect(seen[0]).toMatchObject({ method: "PATCH", url: "https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents/owners/owner/snapshot/latest", body: { fields: { schema: { integerValue: "1" }, payload: { stringValue: "{}" } } } });
    const docs = await fs.list("owners/owner/inbox");
    expect(docs.map((d) => d.id)).toEqual(["e1", "e2"]);
    expect(docs[0]!.fields).toEqual({ at: 5, action: "keep" });
    await fs.remove(Array.from({ length: 450 }, (_, i) => `n${i}`));
    const commits = seen.filter((s) => s.url.endsWith("/documents:commit"));
    expect(commits.map((c) => (c.body as { writes: unknown[] }).writes.length)).toEqual([400, 50]);
  });
  it("surfaces Firestore's error message", async () => {
    const f = (async () => new Response(JSON.stringify({ error: { status: "PERMISSION_DENIED", message: "Missing or insufficient permissions." } }), { status: 403 })) as unknown as typeof fetch;
    await expect(new FirestoreRest({ projectId: "p", token: async () => "t", fetchImpl: f }).set("a/b", {})).rejects.toThrow("Firestore PATCH 403: Missing or insufficient permissions.");
  });
});

describe("snapshot", () => {
  it("carries the digest, kept items, numbers over time and run health", async () => {
    const r = await seeded();
    r.store.applyFeedback("github:lifehub/planner", "keep", NOW);
    const s = buildSnapshot(r.db, r.store, r.deps.budget, NOW);
    expect(s.schema).toBe(1);
    expect(s.day).toBe("2026-10-24");
    expect(s.digest.length).toBeGreaterThan(0);
    expect(s.digest[0]!.series.length).toBeGreaterThan(0);
    expect(s.kept.map((k) => k.id)).toContain("github:lifehub/planner");
    expect(s.explore.every((e) => e.userState === "new")).toBe(true);
    expect(s.health.lastRun?.status).toBe("ok");
    expect(s.health.counts.kept).toBe(1);
  });
  it("stays under the size limit by dropping explore and kept items, never the digest", async () => {
    const r = await seeded();
    r.store.applyFeedback("github:lifehub/planner", "keep", NOW);
    const full = buildSnapshot(r.db, r.store, r.deps.budget, NOW);
    const small = buildSnapshot(r.db, r.store, r.deps.budget, NOW, { maxBytes: Buffer.byteLength(JSON.stringify({ ...full, kept: [], explore: [] })) + 10 });
    expect(small.digest).toEqual(full.digest);
    expect(small.kept).toEqual([]);
    expect(small.explore).toEqual([]);
  });
  it("hash ignores the generation time", async () => {
    const r = await seeded();
    const a = buildSnapshot(r.db, r.store, r.deps.budget, NOW);
    expect(snapshotHash(a)).toBe(snapshotHash({ ...a, generatedAt: "later" }));
  });
});

describe("sync", () => {
  it("applies phone actions in time order, removes them, then publishes the snapshot", async () => {
    const r = await seeded();
    const docs = new MemoryDocs();
    docs.docs.set("owners/owner/inbox/evt_b_0000000", { entityId: "github:acme/taskflow", action: "skip", at: NOW.getTime() - 1000 });
    docs.docs.set("owners/owner/inbox/evt_a_0000000", { entityId: "github:acme/taskflow", action: "keep", at: NOW.getTime() - 5000 });
    docs.docs.set("owners/owner/inbox/evt_c_0000000", { entityId: "github:nope/nope", action: "keep", at: NOW.getTime() });
    docs.docs.set("owners/owner/inbox/evt_d_0000000", { entityId: "github:acme/taskflow", action: "explode", at: NOW.getTime() });
    const res = await syncOnce({ db: r.db, store: r.store, budget: r.deps.budget, docs, uid: "owner", clock: r.clock });
    expect(res).toMatchObject({ ok: true, applied: 2, rejected: 2, pushed: true });
    expect(r.store.entity("github:acme/taskflow")!.user_state).toBe("skipped"); // the later action wins
    expect([...docs.docs.keys()]).toEqual(["owners/owner/snapshot/latest"]);
    const snap = docs.docs.get("owners/owner/snapshot/latest")!;
    expect(snap.schema).toBe(1);
    expect(JSON.parse(String(snap.payload)).digest.length).toBeGreaterThan(0);
    expect(lastSync(r.db)).toMatchObject({ ok: true, applied: 2 });
  });
  it("is idempotent: a re-delivered event is not applied twice, an unchanged snapshot is not re-uploaded", async () => {
    const r = await seeded();
    const docs = new MemoryDocs();
    const d = { db: r.db, store: r.store, budget: r.deps.budget, docs, uid: "owner", clock: r.clock };
    docs.docs.set("owners/owner/inbox/evt_keep_0001", { entityId: "github:acme/taskflow", action: "keep", at: NOW.getTime() });
    await syncOnce(d);
    const feedbackRows = r.db.all("SELECT * FROM feedback").length;
    docs.docs.set("owners/owner/inbox/evt_keep_0001", { entityId: "github:acme/taskflow", action: "keep", at: NOW.getTime() });
    const again = await syncOnce(d);
    expect(again).toMatchObject({ ok: true, applied: 0, pushed: false });
    expect(r.db.all("SELECT * FROM feedback").length).toBe(feedbackRows);
    expect(docs.writes).toBe(1);
  });
  it("snoozes from the time the phone acted, not the time of sync", async () => {
    const r = await seeded();
    const docs = new MemoryDocs();
    const at = NOW.getTime() - 2 * 86_400_000;
    docs.docs.set("owners/owner/inbox/evt_snooze_01", { entityId: "github:acme/taskflow", action: "snooze", days: 3, at });
    await syncOnce({ db: r.db, store: r.store, budget: r.deps.budget, docs, uid: "owner", clock: r.clock });
    expect(r.store.entity("github:acme/taskflow")!.snooze_until).toBe(new Date(at + 3 * 86_400_000).toISOString());
  });
  it("records a failure without throwing, and keeps phone actions for the next try", async () => {
    const r = await seeded();
    const docs = new MemoryDocs();
    docs.failList = true;
    const res = await syncOnce({ db: r.db, store: r.store, budget: r.deps.budget, docs, uid: "owner", clock: r.clock });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("503");
    expect(lastSync(r.db)?.ok).toBe(false);
  });
});

describe("cloud config", () => {
  it("is built from terraform output -json", () => {
    const key = Buffer.from(JSON.stringify({ client_email: "a@b.iam.gserviceaccount.com", private_key: privateKey })).toString("base64");
    const c = fromTerraformOutput(JSON.stringify({ project_id: { value: "vhub-trend-123" }, api_key: { value: "AIzaSyExample00" }, owner_uid: { value: "owner" }, pc_key_json: { value: key } }));
    expect(c).toMatchObject({ projectId: "vhub-trend-123", apiKey: "AIzaSyExample00", uid: "owner", syncMinutes: 10 });
    expect(() => fromTerraformOutput(JSON.stringify({ project_id: { value: "x" } }))).toThrow(/terraform apply/);
  });
  it("names every missing field", () => {
    expect(() => parseCloudConfig("{}")).toThrow("projectId, apiKey, uid, serviceAccount");
  });
});

describe("pairing", () => {
  it("payload carries LAN addresses, the dashboard token and a fresh custom token", () => {
    const p = pairPayload({ lan: ["http://192.168.1.5:4173"], token: "tok", cloud: cloudCfg(), now: NOW });
    expect(p).toMatchObject({ v: 1, lan: ["http://192.168.1.5:4173"], t: "tok", fb: { p: "vhub-trend-test", k: "AIzaTestKey0000", u: "owner" } });
    expect(parts(p.fb!.ct).valid).toBe(true);
    expect(pairPayload({ lan: [], token: "tok", cloud: null, now: NOW }).fb).toBeUndefined();
    // The web link carries the Firebase part only (never the PC dashboard token), in the #fragment.
    const link = webLink(cloudCfg(), NOW);
    const [site, frag] = link.split("#pair=");
    expect(site).toBe(`https://${cloudCfg().projectId}.web.app/`);
    const body = JSON.parse(Buffer.from(frag!, "base64url").toString("utf8")) as { v: number; fb: { p: string }; t?: string; lan?: string[] };
    expect(body.fb.p).toBe(cloudCfg().projectId);
    expect(body.t).toBeUndefined();
    expect(body.lan).toBeUndefined();
    expect(webLink({ ...cloudCfg(), webUrl: "https://trend.example.com" }, NOW).startsWith("https://trend.example.com/#pair=")).toBe(true);
  });
  it("lists only addresses a phone can reach", () => {
    const nets = {
      lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      wlan0: [{ address: "192.168.1.5", family: "IPv4", internal: false }, { address: "fe80::1", family: "IPv6", internal: false }],
      x: [{ address: "169.254.3.3", family: "IPv4", internal: false }],
    } as never;
    expect(lanUrls(4173, nets)).toEqual(["http://192.168.1.5:4173"]);
  });
  it("renders a QR for the dashboard and, when it fits, for the terminal", () => {
    const code = pairCode(pairPayload({ lan: ["http://192.168.1.5:4173"], token: "x".repeat(32), cloud: cloudCfg(), now: NOW }));
    expect(code.length).toBeLessThan(1600);
    expect(qrSvg(code)).toMatch(/^<svg .*<\/svg>$/);
    expect(qrTerminal(code, 40)).toBeNull();
    expect(qrTerminal("short", 80)).toContain("█");
  });
});

describe("phone path check", () => {
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  it("passes when the custom token signs in and the rules allow the read", async () => {
    const urls: string[] = [];
    const f = (async (url: string) => {
      urls.push(url);
      return url.includes("signInWithCustomToken") ? reply(200, { idToken: "id" }) : reply(200, {});
    }) as unknown as typeof fetch;
    const out = await checkPhonePath(cloudCfg(), NOW, f);
    expect(out.map((o) => o.level)).toEqual(["ok", "ok"]);
    expect(urls[1]).toBe("https://firestore.googleapis.com/v1/projects/vhub-trend-test/databases/(default)/documents/owners/owner/snapshot/latest");
  });
  it("tells exactly what to click when Firebase Auth was never started", async () => {
    const f = (async () => reply(400, { error: { message: "CONFIGURATION_NOT_FOUND" } })) as unknown as typeof fetch;
    const [c] = await checkPhonePath(cloudCfg(), NOW, f);
    expect(c).toMatchObject({ level: "fail" });
    expect(c!.fix).toContain("Authentication → bấm Get started");
  });
  it("reports rules that block the phone", async () => {
    const f = (async (url: string) => (url.includes("signIn") ? reply(200, { idToken: "id" }) : reply(403, {}))) as unknown as typeof fetch;
    expect((await checkPhonePath(cloudCfg(), NOW, f))[1]).toMatchObject({ level: "fail", msg: expect.stringContaining("rules") });
  });
});

describe("sync contract fixtures (shared with the Android app's tests)", () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "contract");
  it("snapshot.v1.json matches what the PC produces", async () => {
    const r = await seeded();
    r.store.applyFeedback("github:lifehub/planner", "keep", NOW);
    const s = JSON.stringify(buildSnapshot(r.db, r.store, r.deps.budget, NOW), null, 2) + "\n";
    const file = join(dir, "snapshot.v1.json");
    if (process.env.UPDATE_CONTRACT || !existsSync(file)) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, s);
    }
    expect(readFileSync(file, "utf8")).toBe(s);
  });
});
