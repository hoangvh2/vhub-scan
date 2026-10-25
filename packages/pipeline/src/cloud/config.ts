import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";

/** ~/.vhub-trend/cloud.json, written by `trend cloud connect`. Holds a private key: mode 0600, never in the repo. */
export interface CloudConfig {
  projectId: string;
  /** Firebase Web API key (identifies the project to Auth and Firestore; not a secret). */
  apiKey: string;
  /** Firebase Auth uid the phone signs in as. Same value as the Terraform variable owner_uid. */
  uid: string;
  serviceAccount: { client_email: string; private_key: string };
  /** Minutes between background syncs while `trend serve` runs. */
  syncMinutes: number;
  /** Emulator or test endpoints. Unset = Google production endpoints. */
  firestoreUrl?: string;
  authUrl?: string;
  /** Where the hosted dashboard lives. Unset = https://<projectId>.web.app (the default Firebase Hosting site). */
  webUrl?: string;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function parseCloudConfig(json: string): CloudConfig {
  const raw = JSON.parse(json) as Partial<CloudConfig>;
  const sa = raw.serviceAccount;
  const problems: string[] = [];
  if (typeof raw.projectId !== "string" || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(raw.projectId)) problems.push("projectId");
  if (typeof raw.apiKey !== "string" || raw.apiKey.length < 10) problems.push("apiKey");
  if (typeof raw.uid !== "string" || !ID.test(raw.uid)) problems.push("uid");
  if (!sa || typeof sa.client_email !== "string" || typeof sa.private_key !== "string" || !sa.private_key.includes("PRIVATE KEY")) problems.push("serviceAccount");
  if (problems.length) throw new Error(`cloud.json thiếu hoặc sai: ${problems.join(", ")}. Chạy lại: npm run cloud:connect`);
  return {
    projectId: raw.projectId!,
    apiKey: raw.apiKey!,
    uid: raw.uid!,
    serviceAccount: { client_email: sa!.client_email, private_key: sa!.private_key },
    syncMinutes: Math.max(2, Math.min(240, Number(raw.syncMinutes) || 10)),
    ...(raw.firestoreUrl ? { firestoreUrl: raw.firestoreUrl } : {}),
    ...(raw.authUrl ? { authUrl: raw.authUrl } : {}),
    ...(typeof raw.webUrl === "string" && /^https:\/\/[^\s/]+\/?$/.test(raw.webUrl) ? { webUrl: raw.webUrl.replace(/\/$/, "") } : {}),
  };
}

export function loadCloudConfig(file: string): CloudConfig | null {
  if (!existsSync(file)) return null;
  return parseCloudConfig(readFileSync(file, "utf8"));
}

export function writeCloudConfig(file: string, c: CloudConfig): void {
  writeFileSync(file, JSON.stringify(c, null, 2) + "\n", { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    /* not supported on this filesystem */
  }
}

/** Builds cloud.json from `terraform output -json` of infra/. */
export function fromTerraformOutput(json: string): CloudConfig {
  const out = JSON.parse(json) as Record<string, { value: unknown } | undefined>;
  const v = (k: string): unknown => out[k]?.value;
  const keyB64 = v("pc_key_json");
  if (typeof keyB64 !== "string" || !keyB64) {
    throw new Error("Terraform chưa có pc_key_json. Chạy  terraform apply  trong thư mục infra trước (hoặc xem README mục 'Không tạo được key')");
  }
  const sa = JSON.parse(Buffer.from(keyB64, "base64").toString("utf8")) as { client_email?: string; private_key?: string };
  return parseCloudConfig(
    JSON.stringify({ projectId: v("project_id"), apiKey: v("api_key"), uid: v("owner_uid") ?? "owner", serviceAccount: sa, syncMinutes: 10 }),
  );
}
