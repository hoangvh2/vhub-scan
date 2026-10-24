import { tokens } from "./text.js";

const MASK = (1n << 64n) - 1n;

function fnv64(s: string): bigint {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * 0x100000001b3n) & MASK;
  }
  return h;
}

/** 64-bit SimHash over word unigrams and bigrams. Returns null when the text is too short to compare. */
export function simhash(text: string, minTokens = 6): bigint | null {
  const t = tokens(text);
  if (t.length < minTokens) return null;
  const feats = [...t];
  for (let i = 0; i + 1 < t.length; i++) feats.push(`${t[i]} ${t[i + 1]}`);
  const v = new Array<number>(64).fill(0);
  for (const f of feats) {
    const h = fnv64(f);
    for (let b = 0; b < 64; b++) v[b]! += (h >> BigInt(b)) & 1n ? 1 : -1;
  }
  let out = 0n;
  for (let b = 0; b < 64; b++) if (v[b]! > 0) out |= 1n << BigInt(b);
  return out;
}

export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let n = 0;
  while (x) {
    x &= x - 1n;
    n++;
  }
  return n;
}

export const toHex = (h: bigint): string => h.toString(16).padStart(16, "0");
export const fromHex = (s: string): bigint => BigInt("0x" + s);

/**
 * Nearest-neighbour index for Hamming distance <= 3: the 64 bits are split into 4 bands of 16, and two hashes
 * within distance 3 must agree on at least one band (pigeonhole), so only same-band candidates are compared.
 */
export class SimIndex {
  private bands: Map<number, string[]>[] = [new Map(), new Map(), new Map(), new Map()];
  private hashes = new Map<string, bigint>();

  add(id: string, h: bigint): void {
    this.hashes.set(id, h);
    for (let i = 0; i < 4; i++) {
      const key = Number((h >> BigInt(16 * i)) & 0xffffn);
      const m = this.bands[i]!;
      const list = m.get(key);
      if (list) list.push(id);
      else m.set(key, [id]);
    }
  }

  /** Closest existing id within `maxDist` (<= 3), excluding `selfId`. */
  nearest(h: bigint, maxDist: number, selfId?: string): { id: string; dist: number }[] {
    const seen = new Set<string>();
    const out: { id: string; dist: number }[] = [];
    for (let i = 0; i < 4; i++) {
      const key = Number((h >> BigInt(16 * i)) & 0xffffn);
      for (const id of this.bands[i]!.get(key) ?? []) {
        if (id === selfId || seen.has(id)) continue;
        seen.add(id);
        const d = hamming(h, this.hashes.get(id)!);
        if (d <= maxDist) out.push({ id, dist: d });
      }
    }
    return out.sort((a, b) => a.dist - b.dist);
  }
}
