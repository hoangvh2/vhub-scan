// Builds the static site for Firebase Hosting: the same dashboard page, switched to read Firestore instead of the PC.
// Output: firebase/public/index.html (git-ignored).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "..", "web", "index.html"), "utf8");
if (!page.includes("<!--VH_MODE-->")) throw new Error("web/index.html lost its <!--VH_MODE--> marker");
const out = join(here, "..", "..", "..", "firebase", "public");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "index.html"), page.replace("<!--VH_MODE-->", "<script>window.VH_CLOUD = true;</script>"));
console.log("hosting site written to firebase/public/index.html");
