import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "dist", "web"), { recursive: true });
cpSync(join(root, "web"), join(root, "dist", "web"), { recursive: true });
