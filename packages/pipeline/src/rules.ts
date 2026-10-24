import type { Config } from "./config.js";
import type { EntityRow } from "./model.js";
import { foldText } from "./text.js";

/** Word-boundary match on folded text, so "3d" does not fire inside "3dfx" and "ocr" not inside "democracy". */
export function hasTerm(haystackFolded: string, term: string): boolean {
  const t = foldText(term).trim();
  if (!t) return false;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${esc}(?:$|[^a-z0-9])`).test(haystackFolded);
}

export function textOf(e: Pick<EntityRow, "title" | "description" | "topics">): string {
  return foldText(`${e.title} ${e.description} ${(JSON.parse(e.topics) as string[]).join(" ")}`);
}

export interface RuleContext {
  cfg: Config;
  now: Date;
  /** Stars (or points) gained per day, from observations. */
  velocity: number;
  isHn: boolean;
}

/** Deterministic hard filters. Returns the reason an item is dropped, or null to keep it. Costs no tokens. */
export function applyRules(e: EntityRow, ctx: RuleContext): string | null {
  const { cfg } = ctx;
  if (cfg.scope.blockAuthors.map((a) => a.toLowerCase()).includes((e.author ?? "").toLowerCase())) return "blocked_author";
  if (e.description.trim().length < cfg.rules.minDescriptionChars && !e.from_seed) return "thin";
  const hay = textOf(e);
  for (const w of cfg.scope.exclude) if (hasTerm(hay, w)) return `out_of_scope:${w}`;
  if (e.user_state === "skipped") return "skipped_by_user";
  if (e.created_at && !e.from_seed) {
    const ageDays = (ctx.now.getTime() - Date.parse(e.created_at)) / 86_400_000;
    const maxAge = ctx.isHn ? cfg.rules.hnMaxAgeDays : cfg.rules.maxAgeDays;
    if (ageDays > maxAge && ctx.velocity < cfg.rules.minVelocityForOld) return "old";
  }
  return null;
}
