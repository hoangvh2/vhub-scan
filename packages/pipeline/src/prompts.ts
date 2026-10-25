import { categories, type Config } from "./config.js";
import type { EntityRow } from "./model.js";
import { clip } from "./text.js";

export const TRIAGE_VERSION = "triage-2";
export const CARD_VERSION = "card-1";

/** Categories of triage-1 (before topics); still stored on older items, so the dashboards keep a label for them. */
export const LEGACY_CATEGORIES: Record<string, string> = {
  "work-tool": "Công việc",
  "life-tool": "Đời sống",
  "dev-tool": "Công cụ lập trình",
  "ai-agent": "AI agent",
  automation: "Tự động hoá",
};

/** The triage answer's shape. The category list follows the enabled topics, so it is built per config. */
export const triageSchema = (cfg: Config) => ({
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          s: { type: "integer", minimum: 0, maximum: 3 },
          c: { type: "string", enum: categories(cfg).map((c) => c.id) },
          w: { type: "string", maxLength: 90 },
        },
        required: ["id", "s", "c", "w"],
      },
    },
  },
  required: ["items"],
});

export const cardSchema = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          what: { type: "string", maxLength: 220 },
          learn: { type: "string", maxLength: 220 },
          apply: {
            type: "array",
            maxItems: 2,
            items: {
              type: "object",
              properties: { project: { type: "string" }, how: { type: "string", maxLength: 200 } },
              required: ["project", "how"],
            },
          },
          effort: { type: "string", enum: ["S", "M", "L"] },
          risk: { type: "string", maxLength: 160 },
        },
        required: ["id", "what", "learn", "apply", "effort", "risk"],
      },
    },
  },
  required: ["items"],
};

/** English instructions (fewer tokens), Vietnamese answers (what the user reads). */
export function triageSystem(cfg: Config): string {
  return [
    "You triage software projects for one person who vibe-codes small tools. Reply with JSON only.",
    `Scope: ${cfg.scope.focus}`,
    "Score s: 3 = clearly useful and easy to adapt, 2 = promising, 1 = marginal, 0 = off-topic or too complex. Be strict; most items deserve 0 or 1.",
    `c = category id, one of: ${categories(cfg).map((c) => `${c.id} (${c.label})`).join(", ")}. w = reason in Vietnamese, at most 12 words.`,
    "Input lines: id|name|description|topics|stars|gain per day|sources.",
  ].join("\n");
}

export function triageLine(e: EntityRow, stars: number, gain: number, sources: number, descChars: number): string {
  const topics = (JSON.parse(e.topics) as string[]).slice(0, 5).join(",");
  return `${e.id}|${clip(e.title, 60)}|${clip(e.description, descChars)}|${topics}|${stars}|${gain.toFixed(1)}|${sources}`;
}

export function cardSystem(cfg: Config): string {
  const projects = cfg.projects.length
    ? cfg.projects.map((p) => `- ${p.name}: ${clip(p.summary, 160)}`).join("\n")
    : "- (no projects given: use project \"chung\")";
  return [
    "You write short idea cards for one person who vibe-codes small tools. Reply with JSON only, in Vietnamese.",
    `Scope: ${cfg.scope.focus}`,
    "what = what it is. learn = what is worth learning from it. apply = at most 2 concrete ways to use it in the person's projects.",
    "effort = S (a day), M (a week), L (more). risk = licence, maintenance or scope concerns, one sentence.",
    "Projects:",
    projects,
    "Input blocks start with #id|name, then description and README excerpt.",
  ].join("\n");
}

export function cardBlock(e: EntityRow, readmeChars: number): string {
  const body = e.body ? clip(e.body, readmeChars) : "";
  return `#${e.id}|${clip(e.title, 60)}\n${clip(e.description, 300)}\n${body}${e.license ? `\nlicense:${e.license}` : ""}`;
}
