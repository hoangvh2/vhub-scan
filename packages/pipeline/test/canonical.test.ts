import { describe, expect, it } from "vitest";
import { canonicalKey } from "../src/canonical.js";

describe("canonicalKey", () => {
  it("maps GitHub URLs in any shape to one key", () => {
    const k = "github:owner/repo";
    for (const u of [
      "https://github.com/Owner/Repo",
      "https://www.github.com/owner/repo/",
      "https://github.com/owner/repo.git",
      "https://github.com/owner/repo/tree/main/docs?utm_source=x#readme",
      "https://github.com/owner/repo/issues/3",
    ]) expect(canonicalKey(u)).toBe(k);
  });
  it("decodes Facebook redirect wrappers locally", () => {
    const wrapped = `https://l.facebook.com/l.php?u=${encodeURIComponent("https://github.com/nccong85/escanner-agent-kit?fbclid=abc")}&h=zzz`;
    expect(canonicalKey(wrapped)).toBe("github:nccong85/escanner-agent-kit");
  });
  it("strips tracking parameters and trailing slashes from other URLs", () => {
    expect(canonicalKey("https://www.Example.com/app/?utm_source=a&id=7&fbclid=q")).toBe("url:example.com/app?id=7");
    expect(canonicalKey("https://example.com/app")).toBe(canonicalKey("https://example.com/app/?ref=hn"));
  });
  it("knows store and directory pages", () => {
    expect(canonicalKey("https://play.google.com/store/apps/details?id=com.Foo.bar&hl=vi")).toBe("play:com.foo.bar");
    expect(canonicalKey("https://apps.apple.com/vn/app/foo/id123456789")).toBe("appstore:123456789");
    expect(canonicalKey("https://www.producthunt.com/posts/My-Tool?ref=x")).toBe("ph:my-tool");
    expect(canonicalKey("https://news.ycombinator.com/item?id=42")).toBe("hn:42");
  });
  it("does not throw on garbage", () => {
    expect(canonicalKey("not a url")).toBe("raw:not a url");
  });
});
