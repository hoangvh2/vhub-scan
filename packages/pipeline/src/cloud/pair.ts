import { networkInterfaces } from "node:os";
import qrcode from "qrcode-generator";
import type { CloudConfig } from "./config.js";
import { customToken } from "./google.js";

/**
 * What the phone scans to pair (contract: docs/SYNC.md). Plain JSON so the QR stays as small as possible.
 * `lan`: dashboard addresses on this network; `t`: the dashboard token; `fb`: Firebase project, API key,
 * uid, and a custom token valid for 1 hour (the phone exchanges it once for its own refresh token).
 */
export interface PairPayload {
  v: 1;
  lan: string[];
  t: string;
  fb?: { p: string; k: string; u: string; ct: string };
}

export function pairPayload(o: { lan: string[]; token: string; cloud: CloudConfig | null; now: Date }): PairPayload {
  const p: PairPayload = { v: 1, lan: o.lan, t: o.token };
  if (o.cloud) p.fb = { p: o.cloud.projectId, k: o.cloud.apiKey, u: o.cloud.uid, ct: customToken(o.cloud, o.now) };
  return p;
}

/** Link that signs a browser in to the hosted dashboard. The token rides in the #fragment, which browsers never send to a server. */
export function webLink(cloud: CloudConfig, now: Date): string {
  const body = JSON.stringify({ v: 1, fb: { p: cloud.projectId, k: cloud.apiKey, u: cloud.uid, ct: customToken(cloud, now) } });
  return `${cloud.webUrl ?? `https://${cloud.projectId}.web.app`}/#pair=${Buffer.from(body).toString("base64url")}`;
}

export const pairCode = (p: PairPayload): string => JSON.stringify(p);

/** IPv4 addresses of this PC that a phone on the same Wi-Fi can reach. */
export function lanUrls(port: number, nets = networkInterfaces()): string[] {
  const out: string[] = [];
  for (const list of Object.values(nets)) {
    for (const n of list ?? []) {
      if (n.family === "IPv4" && !n.internal && !n.address.startsWith("169.254.")) out.push(`http://${n.address}:${port}`);
    }
  }
  return out.slice(0, 4);
}

function qr(text: string) {
  const q = qrcode(0, "L");
  q.addData(text, "Byte");
  q.make();
  return q;
}

/** QR as an SVG string (dark modules only; the page supplies a white quiet zone). */
export function qrSvg(text: string): string {
  const q = qr(text);
  const n = q.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
  const s = n + 8;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" shape-rendering="crispEdges" role="img" aria-label="Mã QR ghép nối"><rect width="${s}" height="${s}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

/** QR drawn with half blocks for a terminal, or null when it is wider than the terminal. */
export function qrTerminal(text: string, columns: number): string | null {
  const q = qr(text);
  const n = q.getModuleCount();
  if (n + 4 > columns) return null;
  const dark = (r: number, c: number) => r >= 0 && r < n && c >= 0 && c < n && q.isDark(r, c);
  const lines: string[] = [];
  // Light-on-dark terminals are the norm: print light modules as blocks so the code is not inverted.
  for (let r = -2; r < n + 2; r += 2) {
    let line = "";
    for (let c = -2; c < n + 2; c++) {
      const top = !dark(r, c);
      const bottom = !dark(r + 1, c);
      line += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
    }
    lines.push(line);
  }
  return lines.join("\n");
}
