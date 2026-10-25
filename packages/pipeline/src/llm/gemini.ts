import type { FetchLike } from "../sources/http.js";
import { LlmError, type LlmAdapter, type LlmRequest, type LlmResponse } from "./types.js";

/**
 * USD per million tokens (input, output incl. thinking), Standard tier, from ai.google.dev/gemini-api/docs/pricing on
 * 2026-10-25. Used for the cost shown in the dashboard; the bill itself comes from Google. Unknown model = cost 0.
 */
export const GEMINI_PRICES: Record<string, { in: number; out: number }> = {
  "gemini-2.5-flash-lite": { in: 0.1, out: 0.4 },
  "gemini-3.1-flash-lite": { in: 0.25, out: 1.5 },
  "gemini-3.5-flash-lite": { in: 0.3, out: 2.5 },
  "gemini-3.8-flash": { in: 0.75, out: 3.75 },
};

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

export interface GeminiOptions {
  apiKey: string;
  /** "minimal" keeps thinking tokens (billed as output) near zero on Flash-Lite. Empty = the model's default. */
  thinkingLevel?: string;
  timeoutMs: number;
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

interface Part {
  text?: string;
  thought?: boolean;
}

interface GenerateResponse {
  candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  error?: { code?: number; status?: string; message?: string };
}

export function geminiCost(model: string, inTokens: number, outTokens: number): number {
  const p = GEMINI_PRICES[model];
  return p ? (inTokens * p.in + outTokens * p.out) / 1e6 : 0;
}

/**
 * Gemini API (generateContent, REST) with JSON output constrained by the request's schema. The key goes in a header,
 * never in the URL, so it cannot end up in an error message or a log line. Gemini ignores maxLength in schemas, so
 * callers clip strings themselves.
 */
export class GeminiAdapter implements LlmAdapter {
  readonly name = "gemini";
  private readonly base: string;

  constructor(private readonly o: GeminiOptions) {
    if (!o.apiKey) throw new Error("GEMINI_API_KEY chưa có");
    this.base = (o.baseUrl ?? "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  }

  async call(req: LlmRequest): Promise<LlmResponse> {
    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: "user", parts: [{ text: req.user }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: req.schema,
        // A hard ceiling per call: twice what the answer should need, plus room for minimal thinking.
        maxOutputTokens: req.expectedOutTokens * 2 + 1024,
        ...(this.o.thinkingLevel ? { thinkingConfig: { thinkingLevel: this.o.thinkingLevel } } : {}),
      },
    };
    const f = this.o.fetchImpl ?? fetch;
    let r: Response;
    try {
      r = await f(`${this.base}/v1beta/models/${encodeURIComponent(req.model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.o.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.o.timeoutMs),
      });
    } catch (e) {
      throw new LlmError(`Gemini không trả lời (${e instanceof Error ? e.name : "lỗi mạng"})`, true);
    }
    const text = await r.text();
    let j: GenerateResponse = {};
    try {
      j = text ? (JSON.parse(text) as GenerateResponse) : {};
    } catch {
      /* reported below */
    }
    if (!r.ok) throw httpError(r.status, j.error?.message ?? text.slice(0, 160));

    const u = j.usageMetadata ?? {};
    const inTokens = u.promptTokenCount ?? 0;
    const outTokens = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
    const cand = j.candidates?.[0];
    if (!cand) throw new LlmError(`Gemini không trả kết quả${j.promptFeedback?.blockReason ? ` (chặn: ${j.promptFeedback.blockReason})` : ""}`, false);
    const answer = (cand.content?.parts ?? []).filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("");
    let data: unknown;
    try {
      data = JSON.parse(answer);
    } catch {
      // Cut off at maxOutputTokens: the same request would be cut off again, so do not retry it.
      if (cand.finishReason === "MAX_TOKENS") throw new LlmError("Gemini trả lời quá dài, bị cắt ở giới hạn token", false);
      throw new LlmError(`Gemini trả về JSON không hợp lệ (${cand.finishReason ?? "?"})`, true);
    }
    return { data, usage: { inTokens, outTokens, costUsd: geminiCost(req.model, inTokens, outTokens) } };
  }
}

function httpError(status: number, detail: string): LlmError {
  const d = detail.replace(/\s+/g, " ").slice(0, 160);
  if (status === 402) return new LlmError("Gemini API: hết tiền nạp trước (prepay). Nạp thêm trong Google AI Studio > Billing", false);
  if (status === 401 || status === 403) return new LlmError(`Gemini API từ chối khoá (${status}): ${d}`, false);
  if (status === 429) return new LlmError(`Gemini API: vượt giới hạn tốc độ hoặc chi tiêu (429): ${d}`, true);
  if (status >= 500) return new LlmError(`Gemini API lỗi máy chủ (${status})`, true);
  return new LlmError(`Gemini API lỗi ${status}: ${d}`, false);
}
