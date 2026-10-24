export interface LlmRequest {
  system: string;
  user: string;
  /** JSON Schema the answer must follow. */
  schema: unknown;
  model: string;
  stage: "triage" | "card";
  /** Bump to invalidate cached answers when a prompt changes. */
  promptVersion: string;
  expectedOutTokens: number;
  /** `claude --effort` level; "low" cut output tokens about 4x in a measured triage call. Empty or undefined omits it. */
  effort?: string;
}

export interface LlmUsage {
  inTokens: number;
  outTokens: number;
  costUsd: number;
}

export interface LlmResponse {
  data: unknown;
  usage: LlmUsage;
}

export interface LlmAdapter {
  readonly name: string;
  call(req: LlmRequest): Promise<LlmResponse>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "LlmError";
  }
}
