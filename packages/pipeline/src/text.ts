import { createHash } from "node:crypto";

/** Lower-case, strip diacritics (Vietnamese too), keep letters and digits only. */
export function foldText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase();
}

const STOP = new Set(
  "a an and are as at be by for from has have i in is it its of on or that the this to was we with you your your la va cua cho cac mot nhung duoc trong khi de voi".split(" "),
);

export function tokens(s: string): string[] {
  return foldText(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function jaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Cut to at most `max` characters on a word boundary, no ellipsis (saves tokens). */
export function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const i = cut.lastIndexOf(" ");
  return (i > max * 0.6 ? cut.slice(0, i) : cut).trim();
}

/** README to a compact plain-text excerpt: no badges, images, links, code blocks, html. */
export function cleanReadme(md: string, max: number): string {
  let s = md.replace(/```[\s\S]*?```/g, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ");
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  s = s.replace(/https?:\/\/\S+/g, " ");
  s = s.replace(/^#{1,6}\s*/gm, "").replace(/[*_`>|]+/g, " ");
  return clip(s, max);
}
