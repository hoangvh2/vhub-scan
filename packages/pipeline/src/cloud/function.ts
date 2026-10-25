import { tmpdir } from "node:os";
import { join } from "node:path";
import { githubSettings } from "../config.js";
import { DEFAULT_GEMINI_MODEL, GeminiAdapter } from "../llm/gemini.js";
import { systemClock } from "../model.js";
import { GitHubSource } from "../sources/github.js";
import { HackerNewsSource } from "../sources/hackernews.js";
import { FirestoreRest } from "./firestore.js";
import { MetadataAuth } from "./google.js";
import { runCloudScan, SCAN_REQUESTS } from "./scanJob.js";
import { GcsRest } from "./storage.js";

/** The parts of the Firestore CloudEvent used here: which document was created. */
export interface FirestoreEvent {
  /** "owners/owner/runRequests/20386-1" (extension attribute of Firestore events). */
  document?: string;
  /** "documents/owners/owner/runRequests/20386-1" */
  subject?: string;
}

/** Which request an event is about; null for anything that is not owners/{uid}/runRequests/{id} of this owner. */
export function requestOf(e: FirestoreEvent, uid: string): string | null {
  const path = e.document ?? e.subject?.replace(/^documents\//, "") ?? "";
  const m = /^owners\/([^/]+)\/([^/]+)\/([A-Za-z0-9_-]{1,64})$/.exec(path);
  return m && m[1] === uid && m[2] === SCAN_REQUESTS ? m[3]! : null;
}

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`thiếu biến môi trường ${k} (đặt trong infra/scan.tf)`);
  return v;
};

/**
 * Entry point of the Cloud Function (runtime nodejs22, Firestore "document created" trigger on runRequests).
 * Settings come from the environment set by Terraform; the Gemini key and the GitHub token come from Secret Manager.
 */
export async function scan(event: FirestoreEvent): Promise<void> {
  const uid = env("OWNER_UID");
  const requestId = requestOf(event, uid);
  if (!requestId) {
    console.log(`bỏ qua sự kiện không phải yêu cầu quét: ${event.subject ?? "?"}`);
    return;
  }
  const auth = new MetadataAuth();
  const token = () => auth.token();
  const r = await runCloudScan({
    docs: new FirestoreRest({ projectId: env("PROJECT_ID"), token }),
    blobs: new GcsRest({ bucket: env("DATA_BUCKET"), token }),
    uid,
    requestId,
    clock: systemClock,
    perDay: Number(process.env.SCANS_PER_DAY ?? "2"),
    model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
    adapter: () => new GeminiAdapter({ apiKey: env("GEMINI_API_KEY"), thinkingLevel: process.env.GEMINI_THINKING ?? "minimal", timeoutMs: 120_000 }),
    sources: (cfg) => ({
      github: new GitHubSource({ cfg: githubSettings(cfg), token: process.env.GITHUB_TOKEN || undefined }),
      hn: (last: number) => new HackerNewsSource({ cfg: cfg.sources.hn, lastMaxId: last }),
    }),
    workDir: join(tmpdir(), "vhub-scan"),
    log: (m) => console.log(m),
  });
  console.log(`scan ${requestId}: ${r.status}${r.message ? " " + r.message : ""}`);
}
