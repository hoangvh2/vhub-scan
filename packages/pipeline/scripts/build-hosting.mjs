// Builds the static site for Firebase Hosting: the same dashboard page, switched to sign in with Google and read
// Firestore instead of the PC. The project identifiers come from ~/.vhub-trend/cloud.json (none of them is a secret).
// Output: firebase/public/index.html (git-ignored).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readCloudJson } from "./cloud-json.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "..", "web", "index.html"), "utf8");
if (!page.includes("<!--VH_MODE-->")) throw new Error("web/index.html lost its <!--VH_MODE--> marker");
const out = join(here, "..", "..", "..", "firebase", "public");
mkdirSync(out, { recursive: true });
const c = readCloudJson();
const cfg = JSON.stringify({ p: c.projectId, k: c.apiKey, u: c.uid, c: c.webClientId }).replace(/</g, "\\u003c");
writeFileSync(join(out, "index.html"), page.replace("<!--VH_MODE-->", `<script>window.VH_CLOUD = ${cfg};</script>`));
console.log("hosting site written to firebase/public/index.html");
