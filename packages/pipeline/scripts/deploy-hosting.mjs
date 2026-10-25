// Publishes firebase/public to Firebase Hosting for the project in ~/.vhub-trend/cloud.json.
// Uses your own Google login (`npx firebase-tools login` once); no deploy key is stored anywhere.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readCloudJson } from "./cloud-json.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
let projectId;
try {
  projectId = readCloudJson().projectId;
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
const run = (cmd, args) => spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
if (run("node", ["packages/pipeline/scripts/build-hosting.mjs"]).status !== 0) process.exit(1);
const r = run("npx", ["--yes", "firebase-tools@15", "deploy", "--only", "hosting", "--config", "firebase/firebase.json", "--project", projectId]);
process.exit(r.status ?? 1);
