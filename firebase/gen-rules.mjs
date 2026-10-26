#!/usr/bin/env node
// Builds firebase/firestore.rules (git-ignored) from firestore.rules.tmpl and the allowlist.
// The list comes from the ALLOWED_EMAILS environment variable (comma or space separated). Production rules are
// deployed by Terraform from var.allowed_emails; this script serves the emulator and the tests.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));

export function parseEmails(raw) {
  const emails = [...new Set(raw.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
  // Strict on purpose: whatever passes is pasted inside a string literal of the rules file.
  const bad = emails.filter((e) => !/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(e));
  if (bad.length) throw new Error(`Not a valid email address: ${bad.join(", ")}`);
  if (emails.length === 0) throw new Error("ALLOWED_EMAILS is empty: refusing to generate rules that admit nobody (or everybody) by accident.");
  return emails;
}

/** Extra request ids per day for trying again after a failed scan (keep in step with SCAN_RETRIES in scanJob.ts). */
export const SCAN_RETRIES = 3;

/** The run request ids the rules accept today: today() + '-1' ... today() + '-<scansPerDay + retries>' (none when 0). */
export function scanIds(scansPerDay) {
  if (!Number.isInteger(scansPerDay) || scansPerDay < 0 || scansPerDay > 5) throw new Error("scans per day must be 0..5");
  const n = scansPerDay === 0 ? 0 : scansPerDay + SCAN_RETRIES;
  return Array.from({ length: n }, (_, i) => `today() + '-${i + 1}'`).join(", ");
}

export function renderRules(template, emails, scansPerDay = 2) {
  for (const p of ["__ALLOWED_EMAILS__", "__SCAN_IDS__", "__SCANS_PER_DAY__"]) if (!template.includes(p)) throw new Error(`template has no ${p} placeholder`);
  return template
    .replaceAll("__ALLOWED_EMAILS__", emails.map((e) => `'${e}'`).join(", "))
    .replaceAll("__SCAN_IDS__", scanIds(scansPerDay))
    .replaceAll("__SCANS_PER_DAY__", String(scansPerDay));
}

export function generate(raw, scansPerDay = Number(process.env.SCANS_PER_DAY ?? "2")) {
  const out = renderRules(readFileSync(join(dir, "firestore.rules.tmpl"), "utf8"), parseEmails(raw), scansPerDay);
  writeFileSync(join(dir, "firestore.rules"), out);
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    generate(process.env.ALLOWED_EMAILS ?? "");
    console.log("firebase/firestore.rules written");
  } catch (e) {
    console.error("gen-rules: " + e.message);
    process.exit(1);
  }
}
