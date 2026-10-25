// Builds the source of the cloud scan function (infra/scan.tf zips and uploads it): the compiled pipeline plus a
// package.json whose entry point is dist/cloud/function.js. Run after `npm run build`. Output: infra/build/scan-function
// (git-ignored). Nothing secret goes in: the Gemini key and the GitHub token come from Secret Manager at run time.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "dist");
const out = join(here, "..", "..", "..", "infra", "build", "scan-function");
if (!existsSync(join(dist, "cloud", "function.js"))) throw new Error("chưa build: chạy  npm run build  trước");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
// The dashboard page is not needed in the function.
cpSync(dist, join(out, "dist"), { recursive: true, filter: (p) => !p.startsWith(join(dist, "web")) });
writeFileSync(
  join(out, "package.json"),
  JSON.stringify(
    {
      name: "vhub-trend-scan-function",
      private: true,
      type: "module",
      main: "dist/cloud/function.js",
      // The runtime starts the function through the Functions Framework; no other dependency.
      dependencies: { "@google-cloud/functions-framework": "^3.4.0" },
    },
    null,
    2,
  ) + "\n",
);
console.log(`cloud scan function written to ${out}`);
