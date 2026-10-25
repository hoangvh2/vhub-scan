import { describe, expect, it } from "vitest";
import { GeminiAdapter, geminiCost } from "../src/llm/gemini.js";
import { LlmError, type LlmRequest } from "../src/llm/types.js";

const KEY = "AIzaGeminiTestKey-not-real";
const req: LlmRequest = {
  system: "Reply with JSON only.",
  user: "a|b",
  schema: { type: "object", properties: { items: { type: "array" } } },
  model: "gemini-3.5-flash-lite",
  stage: "triage",
  promptVersion: "t1",
  expectedOutTokens: 100,
};

type Call = { url: string; init: RequestInit };
function fake(status: number, body: unknown) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { calls, a: new GeminiAdapter({ apiKey: KEY, thinkingLevel: "minimal", timeoutMs: 5_000, fetchImpl }) };
}

const ok = (text: string, extra: Record<string, unknown> = {}) => ({
  candidates: [{ content: { parts: [{ text: "thinking...", thought: true }, { text }] }, finishReason: "STOP" }],
  usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 300, thoughtsTokenCount: 50 },
  ...extra,
});

describe("GeminiAdapter", () => {
  it("sends the prompt, the schema and the thinking level, with the key in a header and never in the URL", async () => {
    const { a, calls } = fake(200, ok('{"items":[]}'));
    await a.call(req);
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent");
    expect(url).not.toContain(KEY);
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(KEY);
    const body = JSON.parse(String(init.body));
    expect(body.systemInstruction.parts[0].text).toBe(req.system);
    expect(body.contents[0]).toEqual({ role: "user", parts: [{ text: "a|b" }] });
    expect(body.generationConfig).toEqual({
      responseMimeType: "application/json",
      responseJsonSchema: req.schema,
      maxOutputTokens: 100 * 2 + 1024,
      thinkingConfig: { thinkingLevel: "minimal" },
    });
  });

  it("parses the answer, skips thought parts, and counts thinking tokens as output", async () => {
    const { a } = fake(200, ok('{"items":[{"id":"x"}]}'));
    const r = await a.call(req);
    expect(r.data).toEqual({ items: [{ id: "x" }] });
    expect(r.usage.inTokens).toBe(1000);
    expect(r.usage.outTokens).toBe(350);
    // 1000 × $0.30/M + 350 × $2.50/M
    expect(r.usage.costUsd).toBeCloseTo(0.0003 + 0.000875, 10);
  });

  it("prices only models in the table", () => {
    expect(geminiCost("gemini-3.1-flash-lite", 1_000_000, 1_000_000)).toBeCloseTo(1.75);
    expect(geminiCost("some-future-model", 1_000_000, 1_000_000)).toBe(0);
  });

  it("retries rate limits and server errors, not bad requests, bad keys or an empty prepay balance", async () => {
    const cases: [number, boolean, RegExp][] = [
      [429, true, /429/],
      [503, true, /503/],
      [400, false, /400/],
      [403, false, /từ chối khoá/],
      [402, false, /hết tiền nạp trước/],
    ];
    for (const [status, retryable, msg] of cases) {
      const { a } = fake(status, { error: { code: status, message: `problem ${status} key=${KEY}`.replace(KEY, "redacted") } });
      const e = await a.call(req).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(LlmError);
      expect((e as LlmError).retryable, `status ${status}`).toBe(retryable);
      expect((e as LlmError).message).toMatch(msg);
      expect((e as LlmError).message).not.toContain(KEY);
    }
  });

  it("does not retry an answer cut off at the token ceiling, but does retry other broken JSON", async () => {
    const cut = fake(200, ok('{"items":[{"id"', { candidates: [{ content: { parts: [{ text: '{"items":[{"id"' }] }, finishReason: "MAX_TOKENS" }] }));
    expect(await cut.a.call(req).catch((e: LlmError) => e.retryable)).toBe(false);
    const broken = fake(200, ok("not json"));
    expect(await broken.a.call(req).catch((e: LlmError) => e.retryable)).toBe(true);
  });

  it("reports a blocked prompt without retrying", async () => {
    const { a } = fake(200, { promptFeedback: { blockReason: "SAFETY" }, usageMetadata: { promptTokenCount: 10 } });
    const e = (await a.call(req).catch((x: unknown) => x)) as LlmError;
    expect(e.retryable).toBe(false);
    expect(e.message).toMatch(/SAFETY/);
  });

  it("refuses to start without a key", () => {
    expect(() => new GeminiAdapter({ apiKey: "", timeoutMs: 1 })).toThrow(/GEMINI_API_KEY/);
  });
});
