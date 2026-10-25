import { readFileSync } from "node:fs";
import { parseEmails, renderRules } from "../../firebase/gen-rules.mjs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, getDocs, collection, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const PROJECT = "demo-vhub-trend";
// The same template production uses, with a test allowlist (Terraform substitutes var.allowed_emails the same way).
const TEMPLATE = readFileSync(new URL("../../firebase/firestore.rules.tmpl", import.meta.url), "utf8");
const RULES = renderRules(TEMPLATE, parseEmails("Me@Example.com, wife@example.org"));
const google = (email: string, extra: Record<string, unknown> = {}) => ({ email, email_verified: true, firebase: { sign_in_provider: "google.com" }, ...extra });
let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: RULES, host: "127.0.0.1", port: 8080 },
  });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), "owners/owner/snapshot/latest"), { schema: 1, payload: "{}" });
    await setDoc(doc(c.firestore(), "owners/owner/snapshot/other"), { schema: 1 });
    await setDoc(doc(c.firestore(), "owners/owner/inbox/existing-1"), { entityId: "github:a/b", action: "keep", at: 1 });
  });
});

// Someone signed in with Google whose address is on the allowlist (any uid: the rules look at the address).
const phone = () => env.authenticatedContext("u-me", google("me@example.com")).firestore();
const event = { entityId: "github:acme/taskflow", action: "keep", at: 1792800000000, device: "Pixel 8" };

describe("snapshot", () => {
  it("allowlisted Google accounts can read the latest snapshot, whatever the letter case of the address", async () => {
    await assertSucceeds(getDoc(doc(phone(), "owners/owner/snapshot/latest")));
    await assertSucceeds(getDoc(doc(env.authenticatedContext("u-2", google("WIFE@Example.org")).firestore(), "owners/owner/snapshot/latest")));
  });
  it("nobody else can read it", async () => {
    const snap = "owners/owner/snapshot/latest";
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), snap)));
    await assertFails(getDoc(doc(env.authenticatedContext("u-x", google("mallory@example.com")).firestore(), snap))); // not on the list
    await assertFails(getDoc(doc(env.authenticatedContext("u-x", google("me@example.com", { email_verified: false })).firestore(), snap))); // unverified
    await assertFails(getDoc(doc(env.authenticatedContext("u-x", google("me@example.com", { firebase: { sign_in_provider: "password" } })).firestore(), snap))); // other method
    await assertFails(getDoc(doc(env.authenticatedContext("u-x", { firebase: { sign_in_provider: "custom" } }).firestore(), snap))); // the old QR pairing no longer works
    await assertFails(getDoc(doc(env.authenticatedContext("u-x", { email: "me@example.com.evil.io", email_verified: true, firebase: { sign_in_provider: "google.com" } }).firestore(), snap)));
  });
  it("a signed-in account cannot list, write, or read other snapshot docs", async () => {
    await assertFails(getDocs(collection(phone(), "owners/owner/snapshot")));
    await assertFails(getDoc(doc(phone(), "owners/owner/snapshot/other")));
    await assertFails(setDoc(doc(phone(), "owners/owner/snapshot/latest"), { schema: 1, payload: "{}" }));
    await assertFails(deleteDoc(doc(phone(), "owners/owner/snapshot/latest")));
  });
});

describe("inbox", () => {
  it("an allowlisted account can queue a valid event", async () => {
    await assertSucceeds(setDoc(doc(phone(), "owners/owner/inbox/evt_0123456789"), event));
    await assertSucceeds(setDoc(doc(phone(), "owners/owner/inbox/evt_snooze_01"), { entityId: "hn:1", action: "snooze", days: 7, at: 5 }));
  });
  it("rejects events with bad shape", async () => {
    const bad: Record<string, unknown>[] = [
      { ...event, action: "delete" },
      { ...event, entityId: "" },
      { ...event, entityId: "x".repeat(301) },
      { ...event, at: "yesterday" },
      { ...event, days: 0 },
      { ...event, days: 91 },
      { ...event, extra: true },
      { entityId: "a", action: "keep" },
    ];
    for (const [i, d] of bad.entries()) await assertFails(setDoc(doc(phone(), `owners/owner/inbox/evt_bad_${i}_000`), d));
    await assertFails(setDoc(doc(phone(), "owners/owner/inbox/short"), event));
  });
  it("a signed-in account cannot read, change or delete queued events, nor write to someone else's inbox", async () => {
    await assertFails(getDoc(doc(phone(), "owners/owner/inbox/existing-1")));
    await assertFails(getDocs(collection(phone(), "owners/owner/inbox")));
    await assertFails(updateDoc(doc(phone(), "owners/owner/inbox/existing-1"), { action: "skip" }));
    await assertFails(deleteDoc(doc(phone(), "owners/owner/inbox/existing-1")));
    await assertFails(setDoc(doc(env.authenticatedContext("u-x", google("mallory@example.com")).firestore(), "owners/owner/inbox/evt_0123456789"), event));
    await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), "owners/owner/inbox/evt_0123456789"), event));
  });
  it("everything outside /owners is closed", async () => {
    await assertFails(setDoc(doc(phone(), "owners/owner/other/x1234567"), { a: 1 }));
    await assertFails(setDoc(doc(phone(), "anything/else"), { a: 1 }));
    await assertFails(getDoc(doc(phone(), "owners/owner")));
  });
});

describe("settings inbox", () => {
  const change = { patch: JSON.stringify({ "funnel.digestSize": 6 }), baseRev: "0123456789abcdef", at: 1792800000000, device: "Pixel 8" };
  it("an allowlisted account can send a settings change", async () => {
    await assertSucceeds(setDoc(doc(phone(), "owners/owner/settingsInbox/set_0123456789"), change));
    await assertSucceeds(setDoc(doc(phone(), "owners/owner/settingsInbox/set_0123456780"), { patch: "{}", baseRev: "", at: 1 }));
  });
  it("rejects changes with a bad shape or size", async () => {
    const bad: Record<string, unknown>[] = [
      { ...change, patch: { "funnel.digestSize": 6 } },
      { ...change, patch: "x".repeat(20001) },
      { ...change, baseRev: "x".repeat(65) },
      { ...change, at: "now" },
      { ...change, device: "x".repeat(41) },
      { ...change, extra: 1 },
      { patch: "{}", at: 1 },
    ];
    for (const [i, d] of bad.entries()) await assertFails(setDoc(doc(phone(), `owners/owner/settingsInbox/set_bad_${i}_00`), d));
    await assertFails(setDoc(doc(phone(), "owners/owner/settingsInbox/short"), change));
  });
  it("only allowlisted accounts can send, and nobody can read, change or delete what was sent", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "owners/owner/settingsInbox/set_existing_1"), change);
    });
    await assertFails(setDoc(doc(env.authenticatedContext("u-x", google("mallory@example.com")).firestore(), "owners/owner/settingsInbox/set_0123456789"), change));
    await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), "owners/owner/settingsInbox/set_0123456789"), change));
    await assertFails(getDoc(doc(phone(), "owners/owner/settingsInbox/set_existing_1")));
    await assertFails(getDocs(collection(phone(), "owners/owner/settingsInbox")));
    await assertFails(updateDoc(doc(phone(), "owners/owner/settingsInbox/set_existing_1"), { patch: "{}" }));
    await assertFails(deleteDoc(doc(phone(), "owners/owner/settingsInbox/set_existing_1")));
  });
});

describe("cloud scan requests", () => {
  // Same formula as the rules and scanDay() in the pipeline (Vietnam time).
  const today = () => Math.floor((Date.now() + 7 * 3_600_000) / 86_400_000);
  const req = { at: 1792800000000, device: "Pixel 8" };
  it("an allowlisted account can start today's first and second scan, and read the outcome", async () => {
    const d = today();
    await assertSucceeds(setDoc(doc(phone(), `owners/owner/runRequests/${d}-1`), req));
    await assertSucceeds(setDoc(doc(phone(), `owners/owner/runRequests/${d}-2`), { at: 5 }));
    await assertSucceeds(getDoc(doc(phone(), `owners/owner/runRequests/${d}-1`)));
    await assertSucceeds(getDocs(collection(phone(), "owners/owner/runRequests")));
  });
  it("refuses a third scan today, scans for another day, and any other id", async () => {
    const d = today();
    for (const id of [`${d}-3`, `${d}-0`, `${d - 1}-1`, `${d + 1}-1`, "scan-now-123", `${d}-1x`]) {
      await assertFails(setDoc(doc(phone(), `owners/owner/runRequests/${id}`), req));
    }
  });
  it("refuses a bad shape, a repeat of the same request, and changes to a request", async () => {
    const id = `owners/owner/runRequests/${today()}-1`;
    for (const d of [{ ...req, status: "done" }, { device: "x" }, { at: "now" }, { ...req, device: "x".repeat(41) }]) await assertFails(setDoc(doc(phone(), id), d));
    await assertSucceeds(setDoc(doc(phone(), id), req));
    await assertFails(setDoc(doc(phone(), id), req)); // exists: that would be an update
    await assertFails(updateDoc(doc(phone(), id), { status: "done" }));
    await assertFails(deleteDoc(doc(phone(), id)));
  });
  it("nobody else can start or read scans", async () => {
    const id = `owners/owner/runRequests/${today()}-1`;
    await assertFails(setDoc(doc(env.authenticatedContext("u-x", google("mallory@example.com")).firestore(), id), req));
    await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), id), req));
    await assertFails(getDocs(collection(env.authenticatedContext("u-x", google("mallory@example.com")).firestore(), "owners/owner/runRequests")));
  });
});

describe("cloud scan switched off (cloud_scans_per_day = 0)", () => {
  beforeAll(async () => {
    await env.cleanup();
    env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: renderRules(TEMPLATE, parseEmails("Me@Example.com, wife@example.org"), 0), host: "127.0.0.1", port: 8080 } });
  });
  // The emulator keeps the last rules loaded for the project: put the usual ones back for the test files that follow.
  afterAll(async () => {
    await env.cleanup();
    env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: RULES, host: "127.0.0.1", port: 8080 } });
  });
  it("refuses every scan request, and the rest keeps working", async () => {
    const d = Math.floor((Date.now() + 7 * 3_600_000) / 86_400_000);
    await assertFails(setDoc(doc(phone(), `owners/owner/runRequests/${d}-1`), { at: 1 }));
    await assertSucceeds(getDoc(doc(phone(), "owners/owner/snapshot/latest")));
  });
});
