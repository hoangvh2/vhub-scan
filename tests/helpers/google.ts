// What the web page and the app do after Google hands them an ID token: exchange it with Firebase Auth.
// The Auth emulator accepts an unsigned JSON "ID token" for the google.com provider, so no Google is involved.
export const ALLOWED = "me@example.com,wife@example.org";
export const AUTH = "http://127.0.0.1:9099/identitytoolkit.googleapis.com";

export const fakeGoogleToken = (email: string, verified = true): string => JSON.stringify({ sub: "g-" + email, email, email_verified: verified, name: email.split("@")[0] });

export async function signInWithGoogle(email: string, apiKey = "fake-api-key-for-emulator", verified = true): Promise<{ status: number; idToken: string; refreshToken: string }> {
  const r = await fetch(`${AUTH}/v1/accounts:signInWithIdp?key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ postBody: `id_token=${encodeURIComponent(fakeGoogleToken(email, verified))}&providerId=google.com`, requestUri: "http://localhost", returnIdpCredential: true, returnSecureToken: true }),
  });
  const j = (await r.json()) as { idToken?: string; refreshToken?: string };
  return { status: r.status, idToken: j.idToken ?? "", refreshToken: j.refreshToken ?? "" };
}
