import { createSign } from "node:crypto";
import type { FetchLike } from "../sources/http.js";
import type { CloudConfig } from "./config.js";

const b64url = (b: Buffer | string): string => Buffer.from(b).toString("base64url");

export function signJwt(privateKeyPem: string, claims: Record<string, unknown>): string {
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(claims));
  const s = createSign("RSA-SHA256");
  s.update(`${head}.${body}`);
  return `${head}.${body}.${s.sign(privateKeyPem).toString("base64url")}`;
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/datastore";
export const CUSTOM_TOKEN_AUD = "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit";

/**
 * Firebase custom token for the phone (valid 1 hour, used once at pairing; afterwards the phone keeps
 * its own refresh token). Signed locally with the PC's service-account key.
 */
export function customToken(c: CloudConfig, now: Date): string {
  const iat = Math.floor(now.getTime() / 1000);
  return signJwt(c.serviceAccount.private_key, {
    iss: c.serviceAccount.client_email,
    sub: c.serviceAccount.client_email,
    aud: CUSTOM_TOKEN_AUD,
    iat,
    exp: iat + 3600,
    uid: c.uid,
  });
}

/** OAuth access token for Firestore from the service-account key (JWT bearer grant), cached until shortly before expiry. */
export class ServiceAccountAuth {
  private cached: { token: string; until: number } | null = null;

  constructor(
    private readonly c: CloudConfig,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async token(): Promise<string> {
    // The emulator accepts this fixed token as an administrator and has no OAuth endpoint.
    if (this.c.firestoreUrl) return "owner";
    const t = this.now().getTime();
    if (this.cached && t < this.cached.until) return this.cached.token;
    const iat = Math.floor(t / 1000);
    const assertion = signJwt(this.c.serviceAccount.private_key, {
      iss: this.c.serviceAccount.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat,
      exp: iat + 3600,
    });
    const r = await this.fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
      signal: AbortSignal.timeout(20_000),
    });
    const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!r.ok || !j.access_token) {
      throw new Error(`Google từ chối khoá của PC (${r.status} ${j.error ?? ""}${j.error_description ? ": " + j.error_description : ""}). Khoá có thể đã bị xoá; chạy lại  terraform apply  rồi  npm run cloud:connect`);
    }
    this.cached = { token: j.access_token, until: t + Math.max(60, (j.expires_in ?? 3600) - 120) * 1000 };
    return j.access_token;
  }
}
