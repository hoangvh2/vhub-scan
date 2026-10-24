import { describe, expect, it } from "vitest";
import { hamming, SimIndex, simhash } from "../src/simhash.js";

const A = "A command line assistant that plans your week, tracks habits and automates repetitive daily workflow tasks";

describe("simhash", () => {
  it("is stable and zero distance for identical text", () => {
    expect(hamming(simhash(A)!, simhash(A)!)).toBe(0);
  });
  it("keeps near-copies close and unrelated text far", () => {
    const near = simhash(A + " today")!;
    const far = simhash("Real time ray tracing renderer with vulkan backend and physically based materials for games")!;
    expect(hamming(simhash(A)!, near)).toBeLessThanOrEqual(8);
    expect(hamming(simhash(A)!, far)).toBeGreaterThan(15);
  });
  it("returns null for text too short to compare", () => {
    expect(simhash("tiny tool")).toBeNull();
  });
  it("folds diacritics so Vietnamese variants match", () => {
    const a = simhash("Công cụ quản lý công việc hằng ngày giúp bạn lập kế hoạch và theo dõi thói quen")!;
    const b = simhash("Cong cu quan ly cong viec hang ngay giup ban lap ke hoach va theo doi thoi quen")!;
    expect(hamming(a, b)).toBe(0);
  });
  it("index finds only neighbours within the distance", () => {
    const idx = new SimIndex();
    idx.add("a", simhash(A)!);
    idx.add("far", simhash("Ray tracing renderer with vulkan backend and physically based materials for games and tools")!);
    const hit = idx.nearest(simhash(A)!, 3, "self");
    expect(hit.map((h) => h.id)).toEqual(["a"]);
  });
});
