// PC <-> Firestore <-> phone, end to end against the Firebase emulators (Firestore with the real rules, Auth).
// The PC side is the production code (REST client, sync, custom tokens); the phone side makes the same
// REST calls the Android app makes, signed in with Google (the Auth emulator accepts a fake Google ID token).
import { generateKeyPairSync } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { CloudConfig } from "../../packages/pipeline/src/cloud/config.js";
import { FirestoreRest } from "../../packages/pipeline/src/cloud/firestore.js";
import { ServiceAccountAuth } from "../../packages/pipeline/src/cloud/google.js";
import { syncOnce } from "../../packages/pipeline/src/cloud/sync.js";
import { runPipeline } from "../../packages/pipeline/src/pipeline.js";
import { NOW, rig } from "../../packages/pipeline/test/helpers.js";
import { cfg, world } from "../../packages/pipeline/test/world.js";
import { signInWithGoogle } from "../helpers/google.js";

const PROJECT = "demo-vhub-trend";
const FS = "http://127.0.0.1:8080";
const AUTH = "http://127.0.0.1:9099/identitytoolkit.googleapis.com";
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const cloud: CloudConfig = {
  projectId: PROJECT,
  apiKey: "fake-api-key-for-emulator",
  uid: "owner",
  serviceAccount: { client_email: `vhub-trend-pc@${PROJECT}.iam.gserviceaccount.com`, private_key: privateKey },
  syncMinutes: 10,
  firestoreUrl: FS,
  authUrl: AUTH,
};
const docsUrl = `${FS}/v1/projects/${PROJECT}/databases/(default)/documents`;

async function phoneSignIn(email = "me@example.com"): Promise<string> {
  const r = await signInWithGoogle(email, cloud.apiKey);
  expect(r.status).toBe(200);
  return r.idToken;
}

/** What the app sends when you tap Keep away from home. */
const phoneQueues = (idToken: string, eventId: string, fields: Record<string, unknown>) =>
  fetch(`${docsUrl}/owners/owner/inbox?documentId=${eventId}`, {
    method: "POST",
    headers: { authorization: `Bearer ${idToken}`, "content-type": "application/json" },
    body: JSON.stringify({ fields }),
  });

beforeAll(async () => {
  await fetch(`${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
});

describe("PC and phone through Firestore", () => {
  it("phone action away from home reaches the PC, and the PC's new view reaches the phone", async () => {
    const r = rig({ cfg: cfg(), ...world() });
    await runPipeline(r.deps);
    const auth = new ServiceAccountAuth(cloud);
    const docs = new FirestoreRest({ projectId: PROJECT, token: () => auth.token(), baseUrl: FS });
    const sync = () => syncOnce({ db: r.db, store: r.store, budget: r.deps.budget, docs, uid: "owner", clock: r.clock });

    expect(await sync()).toMatchObject({ ok: true, pushed: true });

    const idToken = await phoneSignIn();
    const snap1 = (await (await fetch(`${docsUrl}/owners/owner/snapshot/latest`, { headers: { authorization: `Bearer ${idToken}` } })).json()) as { fields: { payload: { stringValue: string } } };
    const view1 = JSON.parse(snap1.fields.payload.stringValue) as { digest: { id: string; userState: string }[] };
    const target = view1.digest[0]!.id;

    const ok = await phoneQueues(idToken, "evt_keep_000001", { entityId: { stringValue: target }, action: { stringValue: "keep" }, at: { integerValue: String(NOW.getTime()) }, device: { stringValue: "test" } });
    expect(ok.status).toBe(200);
    const bad = await phoneQueues(idToken, "evt_bad_0000001", { entityId: { stringValue: target }, action: { stringValue: "drop-table" }, at: { integerValue: "1" } });
    expect(bad.status).toBe(403);

    expect(await sync()).toMatchObject({ ok: true, applied: 1, pushed: true });
    expect(r.store.entity(target)!.user_state).toBe("kept");
    expect(await docs.list("owners/owner/inbox")).toEqual([]);

    const snap2 = (await (await fetch(`${docsUrl}/owners/owner/snapshot/latest`, { headers: { authorization: `Bearer ${idToken}` } })).json()) as { fields: { payload: { stringValue: string } } };
    const view2 = JSON.parse(snap2.fields.payload.stringValue) as { kept: { id: string }[] };
    expect(view2.kept.map((k) => k.id)).toContain(target);

    expect(await sync()).toMatchObject({ ok: true, applied: 0, pushed: false });
  });

  it("accounts that are not on the allowlist see nothing (unverified addresses are covered in the rules tests: the Auth emulator marks every Google address verified) and cannot queue events", async () => {
    const snap = `${docsUrl}/owners/owner/snapshot/latest`;
    const stranger = await phoneSignIn("mallory@example.com");
    expect((await fetch(snap, { headers: { authorization: `Bearer ${stranger}` } })).status).toBe(403);
    expect((await phoneQueues(stranger, "evt_stranger_01", { entityId: { stringValue: "x" }, action: { stringValue: "keep" }, at: { integerValue: "1" } })).status).toBe(403);
    const wife = await phoneSignIn("Wife@Example.org");
    expect((await fetch(snap, { headers: { authorization: `Bearer ${wife}` } })).status).toBe(200);
  });
});
