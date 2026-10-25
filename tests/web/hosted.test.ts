// The hosted dashboard (Firebase Hosting build of web/index.html) in a real browser against the Firebase emulators:
// sign in with Google (Google's script is replaced by a stub that hands over a fake ID token, which the Auth emulator
// accepts), read the PC's snapshot, act, and see the action reach the PC on its next sync.
// Set HOSTED_SHOTS=<dir> to also save screenshots.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join, resolve } from "node:path";
import { chromium, devices, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CloudConfig } from "../../packages/pipeline/src/cloud/config.js";
import { FirestoreRest } from "../../packages/pipeline/src/cloud/firestore.js";
import { ServiceAccountAuth } from "../../packages/pipeline/src/cloud/google.js";
import { syncOnce } from "../../packages/pipeline/src/cloud/sync.js";
import { SettingsStore } from "../../packages/pipeline/src/settingsStore.js";
import { runPipeline } from "../../packages/pipeline/src/pipeline.js";
import { rig } from "../../packages/pipeline/test/helpers.js";
import { cfg, world } from "../../packages/pipeline/test/world.js";
import { fakeGoogleToken } from "../helpers/google.js";

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
  const home = mkdtempSync(join(tmpdir(), "vhub-home-"));
  writeFileSync(join(home, "cloud.json"), JSON.stringify({ projectId: PROJECT, apiKey: cloud.apiKey, uid: "owner", webClientId: "1234-test.apps.googleusercontent.com" }));
  execFileSync("node", ["packages/pipeline/scripts/build-hosting.mjs"], { cwd: root, env: { ...process.env, VHUB_TREND_HOME: home } });
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

/** Clicks Google's button as this person. */
async function signInAs(page: Page, email: string) {
  await page.evaluate((t) => { (window as unknown as { __cred: string }).__cred = t; }, fakeGoogleToken(email));
  await page.click("#fake-google");
}

async function open(opts = {}) {
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript(`window.VH_ENDPOINTS = { auth: "${AUTH}/identitytoolkit.googleapis.com", token: "${AUTH}/securetoken.googleapis.com", fs: "${FS}" };
    window.google = { accounts: { id: {
      initialize(o) { window.__gsi = o; },
      renderButton(el) { el.innerHTML = '<button id="fake-google">Đăng nhập với Google</button>'; el.firstChild.onclick = () => window.__gsi.callback({ credential: window.__cred }); },
      disableAutoSelect() {},
    } } };`);
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
  page.on("pageerror", (e) => problems.push(e.message));
  return { ctx, page };
}

describe("hosted dashboard", () => {
  it("signs in with Google, shows the PC's snapshot, an action reaches the PC, and sign-out asks first", async () => {
    const r = rig({ cfg: cfg(), ...world() });
    await runPipeline(r.deps);
    const auth = new ServiceAccountAuth(cloud);
    const docs = new FirestoreRest({ projectId: PROJECT, token: () => auth.token(), baseUrl: FS });
    const sync = () => syncOnce({ db: r.db, store: r.store, budget: r.deps.budget, docs, uid: "owner", clock: r.clock });
    expect(await sync()).toMatchObject({ ok: true, pushed: true });
    const shots = process.env.HOSTED_SHOTS;
    if (shots) mkdirSync(shots, { recursive: true });

    const { ctx, page } = await open({ viewport: { width: 1440, height: 900 } });
    await page.goto(base);
    await page.waitForSelector("#fake-google");
    expect(await page.locator(".rowi").count()).toBe(0);
    if (shots) await page.screenshot({ path: join(shots, "hosted-signin.png") });

    // Not on the allowlist: Firestore refuses, the page says whose account it was and offers the button again.
    await signInAs(page, "mallory@example.com");
    await page.waitForFunction(() => document.body.innerText.includes("mallory@example.com") && document.body.innerText.includes("allowed_emails"));
    await page.waitForSelector("#fake-google");
    expect(await page.locator(".rowi").count()).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem("vhSession"))).toBeNull();
    if (shots) await page.screenshot({ path: join(shots, "hosted-refused.png") });

    await signInAs(page, "me@example.com");
    await page.waitForSelector(".rowi");
    const rows = await page.locator(".rowi").count();
    expect(rows).toBeGreaterThan(0);
    if (shots) await page.screenshot({ path: join(shots, "hosted-today.png") });

    const title = (await page.locator(".rowi >> nth=0").innerText()).split("\n")[0]!;
    await page.keyboard.press("e"); // Keep
    await page.waitForSelector("#toast.on");
    expect(await docs.list("owners/owner/inbox")).toHaveLength(1);

    // The PC applies it on its next sync; the page shows the action meanwhile and afterwards.
    expect(await sync()).toMatchObject({ ok: true, applied: 1 });
    await page.keyboard.press("2");
    await page.waitForSelector(".rowi");
    expect(await page.locator(".rowi").first().innerText()).toContain(title);
    if (shots) await page.screenshot({ path: join(shots, "hosted-kept.png") });

    // Reload: the session survives (refresh token), no sign-in needed.
    await page.goto(base);
    await page.waitForSelector(".rowi");
    await page.keyboard.press("4");
    await page.waitForSelector("#signout");
    expect(await page.locator("body").innerText()).toContain("me@example.com");
    if (shots) await page.screenshot({ path: join(shots, "hosted-system.png") });

    // Sign-out: "Huỷ" keeps the session, "Đăng xuất" ends it.
    await page.click("#signout");
    await page.waitForSelector("dialog[open]");
    if (shots) await page.screenshot({ path: join(shots, "hosted-signout-dialog.png") });
    await page.click("#cd-cancel");
    await page.waitForSelector("dialog", { state: "detached" });
    expect(await page.evaluate(() => localStorage.getItem("vhSession"))).not.toBeNull();
    await page.click("#signout");
    await page.click("#cd-ok");
    await page.waitForSelector("#fake-google");
    expect(await page.evaluate(() => localStorage.getItem("vhSession"))).toBeNull();
    await ctx.close();

    const phone = await open({ ...devices["Pixel 7"] });
    await phone.page.goto(base);
    await phone.page.waitForSelector("#fake-google");
    await signInAs(phone.page, "WIFE@example.org"); // letter case does not matter
    await phone.page.waitForSelector(".rowi");
    if (shots) await phone.page.screenshot({ path: join(shots, "hosted-phone.png") });
    expect(await phone.page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await phone.ctx.close();
    expect(problems.filter((p) => !/Failed to load resource/.test(p))).toEqual([]);
  });

  it("edits a setting on the web; the PC checks it, writes config.json on its next sync, and the page shows it applied", async () => {
    await fetch(`${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
    const r = rig({ cfg: cfg(), ...world() });
    await runPipeline(r.deps);
    const home = mkdtempSync(join(tmpdir(), "vhub-settings-"));
    const settings = new SettingsStore(join(home, "config.json"), home);
    const auth = new ServiceAccountAuth(cloud);
    const docs = new FirestoreRest({ projectId: PROJECT, token: () => auth.token(), baseUrl: FS });
    const sync = () => syncOnce({ db: r.db, store: r.store, budget: r.deps.budget, docs, uid: "owner", clock: r.clock, settings });
    expect(await sync()).toMatchObject({ ok: true, pushed: true, settingsApplied: 0 });
    const shots = process.env.HOSTED_SHOTS;

    const { ctx, page } = await open({ ...devices["Pixel 7"] });
    await page.goto(base);
    await page.waitForSelector("#fake-google");
    await signInAs(page, "me@example.com");
    await page.waitForSelector(".rowi");
    await page.click(".tabbar button >> nth=4");
    await page.fill("#c-funnel-digestSize", "9");
    await page.waitForSelector("#savebar:not([hidden])");
    // Settings only config.json may change are not offered for editing on the hosted page.
    expect(await page.locator("#c-llm-command").evaluate((el) => el.tagName)).toBe("DIV");
    expect(await page.locator("#c-server-port").evaluate((el) => el.tagName)).toBe("DIV");
    await page.click("#save");
    await page.waitForSelector("#settings-pending");
    if (shots) await page.screenshot({ path: join(shots, "hosted-settings-pending.png") });
    const sent = await docs.list("owners/owner/settingsInbox");
    expect(sent).toHaveLength(1);

    // The PC applies it: config.json changes (with a backup), the inbox is emptied, the result goes into the snapshot.
    expect(await sync()).toMatchObject({ ok: true, settingsApplied: 1 });
    expect(settings.load().funnel.digestSize).toBe(9);
    expect(settings.history()[0]).toMatchObject({ source: "web", changed: ["funnel.digestSize"] });
    expect(await docs.list("owners/owner/settingsInbox")).toHaveLength(0);

    await page.goto(base);
    await page.waitForSelector(".rowi");
    await page.click(".tabbar button >> nth=4");
    await page.waitForSelector("#settings-remote");
    expect(await page.locator("#settings-remote").innerText()).toContain("PC đã áp dụng thay đổi từ web");
    expect(await page.locator("#settings-pending").count()).toBe(0);
    expect(await page.inputValue("#c-funnel-digestSize")).toBe("9");
    if (shots) await page.screenshot({ path: join(shots, "hosted-settings-applied.png") });
    await ctx.close();
    expect(problems.filter((p) => !/Failed to load resource/.test(p))).toEqual([]);
  });
});
