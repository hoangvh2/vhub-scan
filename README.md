# VHub Trend Scan

A personal, **PC-first** pipeline that finds small tools and ideas worth building (productivity, automation, daily life, developer workflow), narrows hundreds of items to a handful, explains each in Vietnamese, and shows them on a local dashboard (web now, Android next).

It does **not** touch Facebook. Facebook is where you find people; this finds their public projects (GitHub, Show HN) on its own, so it keeps working when you are busy.

## Status (honest)

| Part | State |
|---|---|
| Pipeline: collect, dedupe, rules, score, triage, card, digest, checkpoints, token budget | Built, 71 automated tests pass |
| Claude CLI adapter | Verified against the real `claude` CLI 2.1.310 (see `docs/DESIGN.md`, "Measured") |
| GitHub and Hacker News connectors | Built and tested **against recorded-shape fixtures only**: the build sandbox cannot reach those APIs. First live run is yours (`trend doctor`, `trend run`) |
| Local web dashboard (`trend serve`) | Built, API tested; the page itself has not been opened in a browser by me |
| Android app, APK release in CI | **Not built yet** |
| Terraform / Firebase / cloud sync | **Not built yet** (cloud is optional, after the MVP) |
| Scheduling on Windows | Command printed by `trend schedule`; **not verified on a real Windows PC** |

## Quick start

Needs Node >= 22.13 and the Claude CLI logged in (`claude`). A free `GITHUB_TOKEN` (no scopes) is strongly recommended.

```sh
npm ci
npm run build
node packages/pipeline/dist/cli.js init          # creates ~/.vhub-trend with config.json and an access token
# edit ~/.vhub-trend/config.json: describe your projects, add GitHub handles under sources.github.seeds
node packages/pipeline/dist/cli.js doctor --llm  # checks Node, token, and makes one tiny real Claude call
node packages/pipeline/dist/cli.js run           # one full run
node packages/pipeline/dist/cli.js serve         # dashboard at http://localhost:4173/?t=<token>
node packages/pipeline/dist/cli.js schedule      # prints how to run it daily
```

`trend serve --lan` lets your phone open the dashboard over your home network. Anyone on the network with the link can read and change your list; the token in the link is the only protection.

## What stays where

Everything lives in `~/.vhub-trend` (or `$VHUB_TREND_HOME`): `trend.sqlite`, `config.json`, `token`. Secrets come from the environment (`GITHUB_TOKEN`), never from files in this repository. Only public project information is stored (name, description, numbers, links); no personal profiles.

## Develop

```sh
npm run typecheck && npm test      # 71 tests, no network, no real LLM
```

Design, decisions and acceptance gates: [`docs/DESIGN.md`](docs/DESIGN.md). Repository conventions: [`CLAUDE.md`](CLAUDE.md).
