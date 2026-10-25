// Renders the dashboard with sample data (packages/pipeline/test/demo) and screenshots it on desktop and phone, light
// and dark. Fails on any console error, page error, or horizontal overflow. Usage: node ui/screens.mjs [outDir]
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright";

const root = resolve(fileURLToPath(import.meta.url), "../../..");
const out = resolve(process.argv[2] ?? "screens");
mkdirSync(out, { recursive: true });
const port = 4199;
const server = spawn(join(root, "node_modules/.bin/vite-node"), ["packages/pipeline/test/demo/serve.ts", "--", String(port)], { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
await new Promise((ok, fail) => {
  server.stdout.on("data", (d) => String(d).includes("demo dashboard") && ok());
  server.on("exit", (c) => fail(new Error("demo server exited " + c)));
  setTimeout(() => fail(new Error("demo server did not start")), 30_000);
});

const base = `http://127.0.0.1:${port}/?t=demo-token`;
const problems = [];
const b = await chromium.launch();
async function shot(name, ctxOpts, fn) {
  const ctx = await b.newContext(ctxOpts);
  const p = await ctx.newPage();
  p.on("console", (m) => m.type() === "error" && problems.push(`${name}: ${m.text()}`));
  p.on("pageerror", (e) => problems.push(`${name}: ${e.message}`));
  await p.goto(base);
  await p.waitForSelector(".rowi, .panel");
  if (fn) await fn(p);
  await p.waitForTimeout(500);
  if (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)) problems.push(`${name}: horizontal overflow`);
  await p.screenshot({ path: join(out, `${name}.png`) });
  await ctx.close();
}
try {
  const desk = { viewport: { width: 1440, height: 900 } };
  await shot("desktop-today-light", { ...desk, colorScheme: "light" });
  await shot("desktop-today-dark", { ...desk, colorScheme: "dark" });
  await shot("desktop-kept-dark", { ...desk, colorScheme: "dark" }, (p) => p.keyboard.press("2"));
  await shot("desktop-system-light", { ...desk, colorScheme: "light" }, (p) => p.keyboard.press("4"));
  await shot("laptop-1100-light", { viewport: { width: 1100, height: 760 }, colorScheme: "light" }, (p) => p.keyboard.press("j"));
  const phone = devices["Pixel 7"];
  await shot("phone-today-light", { ...phone, colorScheme: "light" });
  await shot("phone-detail-light", { ...phone, colorScheme: "light" }, (p) => p.click(".rowi >> nth=0"));
  await shot("phone-today-dark", { ...phone, colorScheme: "dark" });
  await shot("phone-explore-light", { ...phone, colorScheme: "light" }, (p) => p.click(".tabbar button >> nth=2"));
  await shot("phone-system-dark", { ...phone, colorScheme: "dark" }, (p) => p.click(".tabbar button >> nth=3"));
  await shot("phone-explore-topic-dark", { ...phone, colorScheme: "dark" }, async (p) => { await p.click(".tabbar button >> nth=2"); await p.click("#cats .chip >> nth=1"); await p.waitForSelector(".rowi"); });
  // Settings: the page, an unsaved change with its token estimate, and the destructive "delete topic" confirmation.
  await shot("desktop-settings-light", { ...desk, colorScheme: "light" }, (p) => p.keyboard.press("5"));
  await shot("desktop-settings-dirty-dark", { ...desk, colorScheme: "dark" }, async (p) => {
    await p.keyboard.press("5");
    await p.fill("#c-funnel-triageTop", "80");
    await p.locator("#c-funnel-triageTop").scrollIntoViewIfNeeded();
    await p.waitForFunction(() => /→/.test(document.querySelector("#save-detail")?.textContent ?? ""));
  });
  await shot("phone-settings-light", { ...phone, colorScheme: "light" }, (p) => p.click(".tabbar button >> nth=4"));
  await shot("phone-settings-dark", { ...phone, colorScheme: "dark" }, async (p) => { await p.click(".tabbar button >> nth=4"); await p.click(".gnav .chip >> nth=2"); });
  // CLAUDE.md: a destructive action asks first; "Huỷ" keeps the topic, the red action removes it (still unsaved).
  await shot("phone-settings-delete-topic", { ...phone, colorScheme: "light" }, async (p) => {
    await p.click(".tabbar button >> nth=4");
    await p.waitForSelector("[data-del=finance]");
    const n = await p.locator(".topic").count();
    await p.click("[data-del=finance]");
    await p.click("#cd-cancel");
    await p.waitForSelector("dialog.confirm", { state: "detached" });
    if ((await p.locator(".topic").count()) !== n) problems.push("delete topic: Huỷ removed the topic");
    await p.click("[data-del=finance]");
    await p.waitForSelector("dialog.confirm");
    await p.screenshot({ path: join(out, "phone-settings-delete-confirm.png") });
    await p.click("#cd-ok");
    // The dialog's close event (and the re-render after it) runs as a separate task.
    await p.waitForFunction((want) => document.querySelectorAll(".topic").length === want, n - 1, { timeout: 3000 }).catch(() => {});
    if ((await p.locator(".topic").count()) !== n - 1) problems.push("delete topic: Xoá did not remove the topic");
    if (!(await p.locator("#savebar").isVisible())) problems.push("delete topic: no unsaved-changes bar");
  });
} finally {
  await b.close();
  server.kill();
}
console.log(problems.length ? problems.join("\n") : `ok: 17 screenshots in ${out}, no console errors, no horizontal overflow`);
process.exit(problems.length ? 1 : 0);
