// Builds the source of the cloud scan function (infra/scan.tf zips and uploads it): the compiled pipeline plus a
// package.json whose entry point is entry.js. Run after `npm run build`. Output: infra/build/scan-function
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
// Registers `scan` as a CloudEvent function. Without it the Functions Framework treats a plain export as an HTTP
// function unless FUNCTION_SIGNATURE_TYPE says otherwise: the Firestore event then arrives as an HTTP request, is
// skipped, and the request on the phone stays "Đang chờ" forever.
writeFileSync(
  join(out, "entry.js"),
  [
    'import * as functions from "@google-cloud/functions-framework";',
    'import { scan } from "./dist/cloud/function.js";',
    "",
    'functions.cloudEvent("scan", scan);',
    "",
  ].join("\n"),
);
writeFileSync(
  join(out, "package.json"),
  JSON.stringify(
    {
      name: "vhub-trend-scan-function",
      private: true,
      type: "module",
      main: "entry.js",
      // The runtime starts the function through the Functions Framework; no other dependency.
      dependencies: { "@google-cloud/functions-framework": "^3.4.0" },
    },
    null,
    2,
  ) + "\n",
);
console.log(`cloud scan function written to ${out}`);
