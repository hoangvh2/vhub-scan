# VHub Trend Scan: design, decisions, evidence

Decisions by the owner (2026-10-24): PC-first with Claude CLI; Android and web are dashboards over the PC's data; cloud only after the MVP, in its own GCP project; this repository is reused (old code removed, history kept); scope = tools that optimise work and life, excluding image, video, 3D and deep technical projects.

## Pipeline (one run)

```
collect -> refresh -> rules -> score -> triage (LLM) -> enrich -> card (LLM) -> digest
```

| Stage | What | Tokens |
|---|---|---|
| collect | GitHub search + seed authors, Show HN. Canonical key, exact dedupe, SimHash near-dedupe, one observation per entity per day | 0 |
| refresh | Re-read numbers only for kept/analysed repos, at most every 2 days | 0 |
| rules | Hard drops with a stored reason: out of scope, thin, old (unless gaining fast), blocked author, skipped by you | 0 |
| score | Popularity, gain per day, recency, scope fit, seed author, number of sources, learned bias from your Keep/Skip | 0 |
| triage | Top N by score go to one batched call: score 0..3, category, 12-word reason | LLM |
| enrich | README excerpt for card candidates only | 0 |
| card | what / learn / how to apply to your projects / effort / risk, batched | LLM |
| digest | Top K not yet shown; same day re-run returns the same digest; resurfaces only on a big jump | 0 |

**Checkpoints.** All state is in SQLite (WAL). Each stage derives its work from rows (`stage`, `triage_hash`, `card_hash`), source cursors are committed in the same transaction as the items they cover, one observation per entity per day, and LLM answers are cached by hash(model, prompt version, system, user, schema). A crash at any stage therefore resumes by simply running again. A killed process leaves a `running` row; the next run takes over once its pid is dead.

**Dedupe.** Layer 1: canonical key (`github:owner/repo`, `hn:id`, URLs without tracking parameters, Facebook link wrappers decoded locally, store and Product Hunt ids). Layer 2: SimHash of the description with Hamming distance <= 3 and repo-name similarity >= 0.4; the merged copy is remembered as an alias and never overwrites the entity's text or numbers. Layer 3 (semantic, embeddings) is deliberately not built: a paraphrase is not merged today (test "known limitation").

## Measured (real runs in the build sandbox, Claude CLI 2.1.310)

| Fact | Value |
|---|---|
| `claude -p` with `--json-schema --tools ""`, prompt on stdin, flags in `ClaudeCliAdapter` | Works; JSON result has `structured_output`, `usage`, `total_cost_usd` |
| Fixed input per call, even for a one-line request | ~1.8k tokens per turn, ~3.7k per call (structured output takes two turns). Hence batching |
| `--effort low` on a 6-item triage | Output tokens 3,521 -> 904, 15 s -> 6 s, same scores. Configured by default |
| Same triage prompt twice | Scores can differ between runs (two items moved by 1). Hence the content-hash cache |
| Full pipeline, real Claude, 5 stubbed repos | 1 dropped by rules, 4 triaged, 3 carded, 3 in digest, 2 LLM calls, 7.2k tokens, 16 s, $0.022 at list price (a subscription is not billed per token, but this is the equivalent) |
| Quality of the 3 real cards | Vietnamese, relevant, and one card noticed that the README did not match the description |

**Not measured:** live GitHub/HN responses (sandbox blocks both), real-world funnel ratios, the 14-day unattended run, behaviour on Windows.

## Acceptance gates

| Gate | Target | Status |
|---|---|---|
| G1 unattended | 14 days, <= 1 missed run | Not measurable yet |
| G2 usefulness | Keep >= 30% after 4 weeks; rating >= 3/5 | Not measurable yet (needs your Keep/Skip) |
| G3 duplicates | shown < 2%; wrong merges < 1% on 200 labelled pairs | 8 labelled cases pass; the 200-pair set does not exist yet |
| G4 tokens | <= 30k/day, no repeated calls | 0 repeated calls proven by test; daily total depends on real volume |
| G5 checkpoint | identical result after a crash at any stage | Proven by test for all 8 stages |
| G6 cost | <= $2/month | Cloud cost is 0 (no cloud). LLM list-price equivalent not yet known at real volume |
| G7 time | <= 10 min per run | 16 s for a 5-item run; real volume unknown |

## Roadmap

1. **Calibrate (next):** run live for a week, label ~100 items Keep/Skip, tune rules and SimHash threshold, measure the real funnel.
2. **Android app** (Kotlin Compose, reads the PC's API over LAN with the token), release APK signed in CI on merge to `main`.
3. **Cloud (optional), built 2026-10-24:** own GCP project on the free Spark plan, Terraform in `infra/` in the style of `hoangvh2/my-recap`, Firestore rules in `firebase/`, the PC pushes one snapshot document and drains a phone inbox; the phone signs in with a custom token minted at pairing. No Hosting yet (the dashboard stays on the PC). Details and data contract: [`SYNC.md`](SYNC.md).

Facebook stays manual: you read, and add the builder's GitHub handle to `sources.github.seeds` once.
