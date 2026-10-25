// Publishes firebase/public to Firebase Hosting for the project in ~/.vhub-trend/cloud.json.
// Uses your own Google login (`npx firebase-tools login` once); no deploy key is stored anywhere.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const home = process.env.VHUB_TREND_HOME || join(homedir(), ".vhub-trend");
let projectId;
try {
  projectId = JSON.parse(readFileSync(join(home, "cloud.json"), "utf8")).projectId;
} catch {
  console.error("Chưa có " + join(home, "cloud.json") + ". Làm bước kết nối cloud trước (npm run cloud:connect).");
  process.exit(1);
}
const run = (cmd, args) => spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
if (run("node", ["packages/pipeline/scripts/build-hosting.mjs"]).status !== 0) process.exit(1);
const r = run("npx", ["--yes", "firebase-tools@15", "deploy", "--only", "hosting", "--config", "firebase/firebase.json", "--project", projectId]);
process.exit(r.status ?? 1);
