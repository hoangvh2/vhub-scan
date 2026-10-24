import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, getDocs, collection, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const PROJECT = "demo-vhub-trend";
let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync(fileURLToPath(new URL("../../firebase/firestore.rules", import.meta.url)), "utf8"), host: "127.0.0.1", port: 8080 },
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

// A phone paired by the PC: custom-token sign-in as uid "owner".
const phone = () => env.authenticatedContext("owner", { firebase: { sign_in_provider: "custom" } }).firestore();
const event = { entityId: "github:acme/taskflow", action: "keep", at: 1792800000000, device: "Pixel 8" };

describe("snapshot", () => {
  it("the paired phone can read the latest snapshot", async () => {
    await assertSucceeds(getDoc(doc(phone(), "owners/owner/snapshot/latest")));
  });
  it("nobody else can read it: signed out, another uid, or the owner's uid from another sign-in method", async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "owners/owner/snapshot/latest")));
    await assertFails(getDoc(doc(env.authenticatedContext("mallory", { firebase: { sign_in_provider: "custom" } }).firestore(), "owners/owner/snapshot/latest")));
    await assertFails(getDoc(doc(env.authenticatedContext("owner", { firebase: { sign_in_provider: "anonymous" } }).firestore(), "owners/owner/snapshot/latest")));
  });
  it("the phone cannot list, write, or read other snapshot docs", async () => {
    await assertFails(getDocs(collection(phone(), "owners/owner/snapshot")));
    await assertFails(getDoc(doc(phone(), "owners/owner/snapshot/other")));
    await assertFails(setDoc(doc(phone(), "owners/owner/snapshot/latest"), { schema: 1, payload: "{}" }));
    await assertFails(deleteDoc(doc(phone(), "owners/owner/snapshot/latest")));
  });
});

describe("inbox", () => {
  it("the phone can queue a valid event", async () => {
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
  it("the phone cannot read, change or delete queued events, nor write to someone else's inbox", async () => {
    await assertFails(getDoc(doc(phone(), "owners/owner/inbox/existing-1")));
    await assertFails(getDocs(collection(phone(), "owners/owner/inbox")));
    await assertFails(updateDoc(doc(phone(), "owners/owner/inbox/existing-1"), { action: "skip" }));
    await assertFails(deleteDoc(doc(phone(), "owners/owner/inbox/existing-1")));
    await assertFails(setDoc(doc(phone(), "owners/someone/inbox/evt_0123456789"), event));
    await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), "owners/owner/inbox/evt_0123456789"), event));
  });
  it("everything outside /owners is closed", async () => {
    await assertFails(setDoc(doc(phone(), "anything/else"), { a: 1 }));
    await assertFails(getDoc(doc(phone(), "owners/owner")));
  });
});
