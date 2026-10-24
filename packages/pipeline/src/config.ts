import { readFileSync } from "node:fs";

export interface Config {
  scope: {
    /** Words that raise the heuristic score (tools for work and life). */
    include: string[];
    /** Words that drop an item outright (out-of-scope, or too complex to vibe-code). */
    exclude: string[];
    blockAuthors: string[];
    /** One short paragraph handed to the LLM as the rubric. */
    focus: string;
  };
  projects: { name: string; summary: string }[];
  sources: {
    github: { enabled: boolean; queries: string[]; seeds: string[]; perQuery: number; refreshMax: number };
    hn: { enabled: boolean; maxItems: number };
  };
  rules: { maxAgeDays: number; hnMaxAgeDays: number; minDescriptionChars: number; minVelocityForOld: number };
  dedupe: { hammingMax: number; titleJaccardMin: number };
  funnel: {
    triageTop: number;
    triageBatch: number;
    cardMinScore: number;
    cardTop: number;
    cardBatch: number;
    digestSize: number;
    descriptionChars: number;
    readmeChars: number;
  };
  llm: {
    kind: "claude-cli" | "fake";
    command: string;
    triageModel: string;
    cardModel: string;
    /** `claude --effort` for each stage: low | medium | high | xhigh | max, or "" to leave it to the CLI. */
    triageEffort: string;
    cardEffort: string;
    timeoutMs: number;
  };
  budget: { dailyTokens: number };
  server: { port: number };
}

export const defaultConfig: Config = {
  scope: {
    include: [
      "productivity", "automation", "workflow", "assistant", "planner", "todo", "notes", "note-taking", "calendar",
      "habit", "tracker", "budget", "personal", "organizer", "reminder", "dashboard", "self-hosted", "checklist",
      "journal", "finance", "time tracking", "template", "cli", "agent", "claude code", "plugin", "tool",
    ],
    exclude: [
      "image processing", "computer vision", "video", "3d", "rendering", "ray tracing", "opengl", "vulkan", "cuda",
      "diffusion", "stable diffusion", "game engine", "compiler", "kernel", "operating system", "blockchain",
      "crypto", "nft", "fine-tuning", "model training", "point cloud", "slam", "ffmpeg", "photo editor", "ocr",
    ],
    blockAuthors: [],
    focus:
      "Tools that help one person work or live better (productivity, automation, personal organisation, developer workflow). Skip anything centred on image, video, 3D, or deep technical systems that are unwise to vibe-code.",
  },
  projects: [],
  sources: {
    github: {
      enabled: true,
      queries: ["topic:claude-code created:>{d14} stars:>=3", "topic:productivity created:>{d14} stars:>=5"],
      seeds: [],
      perQuery: 30,
      refreshMax: 40,
    },
    hn: { enabled: true, maxItems: 60 },
  },
  rules: { maxAgeDays: 90, hnMaxAgeDays: 14, minDescriptionChars: 20, minVelocityForOld: 2 },
  dedupe: { hammingMax: 3, titleJaccardMin: 0.4 },
  funnel: {
    triageTop: 40,
    triageBatch: 20,
    cardMinScore: 2,
    cardTop: 8,
    cardBatch: 4,
    digestSize: 5,
    descriptionChars: 160,
    readmeChars: 1200,
  },
  llm: { kind: "claude-cli", command: "claude", triageModel: "haiku", cardModel: "sonnet", triageEffort: "low", cardEffort: "low", timeoutMs: 180_000 },
  budget: { dailyTokens: 60_000 },
  server: { port: 4173 },
};

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

function merge<T>(base: T, over: unknown, path = ""): T {
  if (over === undefined) return base;
  if (isObj(base)) {
    if (!isObj(over)) throw new Error(`config ${path || "(root)"}: expected an object`);
    const out: Json = { ...base };
    for (const [k, v] of Object.entries(over)) {
      if (!(k in base)) throw new Error(`config: unknown key "${path}${k}"`);
      out[k] = merge((base as Json)[k], v, `${path}${k}.`);
    }
    return out as T;
  }
  if (Array.isArray(base)) {
    if (!Array.isArray(over)) throw new Error(`config ${path.slice(0, -1)}: expected an array`);
    return over as T;
  }
  if (typeof base !== typeof over) throw new Error(`config ${path.slice(0, -1)}: expected ${typeof base}`);
  return over as T;
}

export function parseConfig(json: string): Config {
  return merge(defaultConfig, JSON.parse(json));
}

export function loadConfig(file: string | null): Config {
  if (!file) return defaultConfig;
  return parseConfig(readFileSync(file, "utf8"));
}
