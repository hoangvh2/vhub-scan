import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { defaultConfig, parseConfig } from "../src/config.js";

describe("config", () => {
  it("merges a partial file over the defaults", () => {
    const c = parseConfig('{"budget":{"dailyTokens":1234},"scope":{"blockAuthors":["x"]}}');
    expect(c.budget.dailyTokens).toBe(1234);
    expect(c.scope.blockAuthors).toEqual(["x"]);
    expect(c.scope.exclude).toEqual(defaultConfig.scope.exclude);
  });
  it("rejects typos and wrong types instead of silently ignoring them", () => {
    expect(() => parseConfig('{"budgett":{}}')).toThrow(/unknown key/);
    expect(() => parseConfig('{"budget":{"dailyTokens":"many"}}')).toThrow(/expected number/);
    expect(() => parseConfig('{"scope":{"include":"productivity"}}')).toThrow(/expected an array/);
  });
  it("the shipped example is valid", () => {
    const c = parseConfig(readFileSync(new URL("../config.example.json", import.meta.url), "utf8"));
    expect(c.projects.length).toBeGreaterThan(0);
  });
});
