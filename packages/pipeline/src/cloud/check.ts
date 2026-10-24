import type { FetchLike } from "../sources/http.js";
import type { CloudConfig } from "./config.js";
import { customToken } from "./google.js";

export interface CloudCheck {
  level: "ok" | "warn" | "fail";
  msg: string;
  fix?: string;
}

const FIX_AUTH =
  "mở https://console.firebase.google.com → chọn project → Build → Authentication → bấm Get started (một lần, không cần bật nhà cung cấp nào). Rồi chạy lại: npm run doctor";

/**
 * Walks the phone's path end to end, as the phone would: sign in with a custom token minted by this PC,
 * then read the published snapshot through the security rules. Run after a sync.
 */
export async function checkPhonePath(c: CloudConfig, now: Date, fetchImpl: FetchLike = fetch): Promise<CloudCheck[]> {
  const out: CloudCheck[] = [];
  const authBase = (c.authUrl ?? "https://identitytoolkit.googleapis.com").replace(/\/$/, "");
  let idToken = "";
  try {
    const r = await fetchImpl(`${authBase}/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(c.apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: customToken(c, now), returnSecureToken: true }),
      signal: AbortSignal.timeout(20_000),
    });
    const j = (await r.json().catch(() => ({}))) as { idToken?: string; error?: { message?: string } };
    if (!r.ok || !j.idToken) {
      const m = j.error?.message ?? String(r.status);
      if (/CONFIGURATION_NOT_FOUND/.test(m)) out.push({ level: "fail", msg: "Firebase Authentication chưa được khởi tạo cho project", fix: FIX_AUTH });
      else if (/API_KEY|API key/i.test(m)) out.push({ level: "fail", msg: `API key bị từ chối (${m})`, fix: "chạy lại  terraform apply  trong infra, rồi  npm run cloud:connect" });
      else if (/INVALID_CUSTOM_TOKEN|CREDENTIAL_MISMATCH/.test(m)) out.push({ level: "fail", msg: `Firebase không nhận token do PC ký (${m})`, fix: "khoá trong cloud.json không thuộc project này; chạy lại  npm run cloud:connect" });
      else out.push({ level: "fail", msg: `điện thoại sẽ không đăng nhập được (${m})`, fix: FIX_AUTH });
      return out;
    }
    idToken = j.idToken;
    out.push({ level: "ok", msg: `đăng nhập kiểu điện thoại (custom token, uid "${c.uid}")` });
  } catch (e) {
    out.push({ level: "fail", msg: `không gọi được Firebase Auth: ${e instanceof Error ? e.message : e}`, fix: "kiểm tra mạng của PC rồi chạy lại" });
    return out;
  }
  const fsBase = (c.firestoreUrl ?? "https://firestore.googleapis.com").replace(/\/$/, "");
  try {
    const r = await fetchImpl(`${fsBase}/v1/projects/${c.projectId}/databases/(default)/documents/owners/${c.uid}/snapshot/latest`, {
      headers: { authorization: `Bearer ${idToken}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (r.ok) out.push({ level: "ok", msg: "điện thoại đọc được snapshot qua Firestore rules" });
    else if (r.status === 404) out.push({ level: "warn", msg: "chưa có snapshot trên cloud", fix: "chạy: npm run sync" });
    else if (r.status === 403) out.push({ level: "fail", msg: "Firestore rules chặn điện thoại đọc snapshot", fix: "chạy lại  terraform apply  trong infra (rules nằm ở firebase/firestore.rules)" });
    else out.push({ level: "fail", msg: `đọc snapshot lỗi ${r.status}`, fix: "chạy lại  npm run doctor  sau vài phút; vẫn lỗi thì xem infra/README.md mục Lỗi thường gặp" });
  } catch (e) {
    out.push({ level: "fail", msg: `không gọi được Firestore: ${e instanceof Error ? e.message : e}`, fix: "kiểm tra mạng của PC rồi chạy lại" });
  }
  return out;
}
