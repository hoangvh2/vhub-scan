// The hosted dashboard (Firebase Hosting build of web/index.html) in a real browser against the Firebase emulators:
// pair from the link, read the PC's snapshot, act, and see the action reach the PC on its next sync.
// Set HOSTED_SHOTS=<dir> to also save screenshots.
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join, resolve } from "node:path";
import { chromium, devices, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CloudConfig } from "../../packages/pipeline/src/cloud/config.js";
import { FirestoreRest } from "../../packages/pipeline/src/cloud/firestore.js";
import { ServiceAccountAuth } from "../../packages/pipeline/src/cloud/google.js";
import { webLink } from "../../packages/pipeline/src/cloud/pair.js";
import { syncOnce } from "../../packages/pipeline/src/cloud/sync.js";
import { runPipeline } from "../../packages/pipeline/src/pipeline.js";
import { rig } from "../../packages/pipeline/test/helpers.js";
import { cfg, world } from "../../packages/pipeline/test/world.js";

const PROJECT = "demo-vhub-trend";
const FS = "http://127.0.0.1:8080";
const AUTH = "http://127.0.0.1:9099";
const root = resolve(import.meta.dirname, "../..");
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const cloud: CloudConfig = {
  projectId: PROJECT, apiKey: "fake-api-key-for-emulator", uid: "owner", syncMinutes: 10,
  serviceAccount: { client_email: `vhub-trend-pc@${PROJECT}.iam.gserviceaccount.com`, private_key: privateKey },
  firestoreUrl: FS, authUrl: `${AUTH}/identitytoolkit.googleapis.com`,
};

let server: Server, base = "", browser: Browser;
const problems: string[] = [];

beforeAll(async () => {
  await fetch(`${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  execFileSync("node", ["packages/pipeline/scripts/build-hosting.mjs"], { cwd: root });
  const html = readFileSync(join(root, "firebase/public/index.html"));
  server = createServer((_, res) => res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html));
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  server?.close();
});

async function open(opts = {}) {
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript(`window.VH_ENDPOINTS = { auth: "${AUTH}/identitytoolkit.googleapis.com", token: "${AUTH}/securetoken.googleapis.com", fs: "${FS}" };`);
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
  page.on("pageerror", (e) => problems.push(e.message));
  return { ctx, page };
}

describe("hosted dashboard", () => {
  it("pairs from the link, shows the PC's snapshot, and an action reaches the PC", async () => {
    const r = rig({ cfg: cfg(), ...world() });
    await runPipeline(r.deps);
    const auth = new ServiceAccountAuth(cloud);
    const docs = new FirestoreRest({ projectId: PROJECT, token: () => auth.token(), baseUrl: FS });
    const sync = () => syncOnce({ db: r.db, store: r.store, budget: r.deps.budget, docs, uid: "owner", clock: r.clock });
    expect(await sync()).toMatchObject({ ok: true, pushed: true });

    const link = webLink(cloud, new Date()).replace("https://demo-vhub-trend.web.app", base);
    const { ctx, page } = await open({ viewport: { width: 1440, height: 900 } });
    await page.goto(link);
    await page.waitForSelector(".rowi");
    expect(page.url()).toBe(base + "/"); // the token is gone from the address bar
    const rows = await page.locator(".rowi").count();
    expect(rows).toBeGreaterThan(0);
    const shots = process.env.HOSTED_SHOTS;
    if (shots) { mkdirSync(shots, { recursive: true }); await page.screenshot({ path: join(shots, "hosted-today.png") }); }

    const title = (await page.locator(".rowi >> nth=0").innerText()).split("\n")[0]!;
    await page.keyboard.press("e"); // Keep
    await page.waitForSelector("#toast.on");
    const pending = await docs.list("owners/owner/inbox");
    expect(pending).toHaveLength(1);

    // The PC applies it on its next sync; the page keeps showing the action meanwhile and afterwards.
    expect(await sync()).toMatchObject({ ok: true, applied: 1 });
    await page.keyboard.press("2");
    await page.waitForSelector(".rowi");
    expect(await page.locator(".rowi").first().innerText()).toContain(title);
    if (shots) await page.screenshot({ path: join(shots, "hosted-kept.png") });

    // Reload: the session survives (refresh token), no link needed.
    await page.goto(base);
    await page.waitForSelector(".rowi");
    await page.keyboard.press("4");
    await page.waitForSelector(".tile");
    if (shots) await page.screenshot({ path: join(shots, "hosted-system.png") });
    await ctx.close();

    const phone = await open({ ...devices["Pixel 7"] });
    await phone.page.goto(link.replace(/#pair=.*/, "") + "#pair=" + link.split("#pair=")[1]);
    await phone.page.waitForSelector(".rowi");
    if (shots) await phone.page.screenshot({ path: join(shots, "hosted-phone.png") });
    expect(await phone.page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await phone.ctx.close();
  });

  it("an unpaired browser is told how to pair, and a broken link does not crash", async () => {
    const a = await open();
    await a.page.goto(base);
    await a.page.waitForSelector(".empty, .rowi");
    expect(await a.page.locator("body").innerText()).toContain("npm run pair");
    await a.ctx.close();

    const b = await open();
    await b.page.goto(base + "/#pair=not-a-link");
    await b.page.waitForSelector(".empty");
    expect(await b.page.locator("body").innerText()).toContain("npm run pair");
    await b.ctx.close();
    expect(problems.filter((p) => !/Failed to load resource/.test(p))).toEqual([]);
  });
});
