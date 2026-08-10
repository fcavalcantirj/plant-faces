# CLAUDE.md — plant-faces

> _Last updated: 2026-08-10_

## 🚨🚨🚨 SESSION HANDOVER IN EFFECT (2026-08-10) — READ THIS FIRST 🚨🚨🚨

**The founding session of this project hit context limits on 2026-08-10 after
completing EVERY pre-hardware wave. If you are an agent picking this repo up:
DO NOT start from the code. Start from the handover.**

1. **`HANDOVER.md`** (repo root, gitignored — local disk only): the paste-ready
   executor briefing. Live-system map, credentials locations, next steps,
   Felipe's working rules. If it is missing, the same text lives in the plan
   file below under "SESSION HANDOVER".
2. **The master plan**: `~/.claude/plans/study-research-and-repo-soft-falcon.md`
   — spec, execution ledger (DoD + Check per task), wave statuses, decision
   register. Single source of truth.
3. **Solvr room `vpd-brand-domains`**: the crystallized task-by-task history
   (every dispatch + verified outcome). Join as `executor`; the room token is in
   `HANDOVER.md` — never commit it.

**State at handover, one line:** everything before the soldering iron is DONE
and LIVE — watch app `plant-faces.vercel.app` (+ `/p/mock-pepper` public), voice
`plant-talks.vercel.app`, Telegram `@PlantFacesbot`, agent "Bode" on brownet,
Postgres archive + KV shim + mock node + reconcile on the Oracle "plant-faces"
box, firmware compiled. **Next physical step: the bench** — probe into the real
pepper (Bode), per `home-automations/builds/plant-node.md`.

## What this repo is

A plant with a face. Soil probe readings → ONE modular ingest door → pure-math
mood verdict → particle face (web), voice (Agent Faces bridge), Telegram — and a
durable archive feeding an open scientific dataset (OpenVPD, parked name).

- `web/` — Next.js app. All real logic in `web/lib/` (mood engine, channels,
  registry, archive, stats). Tests: `cd web && pnpm test` (node --test).
- `firmware/` — ESPHome node (WROOM-32 + MAX485 + THCPH-S). `secrets.yaml`
  gitignored, carries the real device token.
- `dataset/` — ETL, schema, VPD math (Tetens + propagated σ), Thales backfill.
  Tests: `.venv/bin/pytest`.
- `agent/` — Bode's SOUL, deterministic `plant` tools, watcher, deploy runbook
  (brownet).
- Secrets: `.env.archive.local` (gitignored) — archive DB, admin key, KV pair,
  Groq, Telegram.

## Non-negotiables (violating these gets work rejected)

- **No LLM anywhere near the verdict.** The mood is pure math from raw
  readings; the agent quotes tool outputs — every spoken number must exist in a
  tool output of that turn.
- **Refuse, don't clamp.** No imputation ever; gaps get flagged.
- Simulator/mock data never reaches any published dataset (`mock-pepper` is
  clearly labeled; Bode's token stays clean until the real probe posts).
- Deploy → test → **commit only on Felipe's word**; push via
  `gh auth switch --user fcavalcantirj` (switch back to fcavalcanti-onvida
  after).
- Never ask Felipe to run tunnels/commands — deliver working URLs.
- Face is the ORIGINAL EIDOLON. Three plant-face redesigns were rejected and
  live on branch `face-experiments` — do not reopen without Felipe.
- Slow dispatch: one subagent per task, verify its Check on the ground before
  the next; crystallize tasks + outcomes in the Solvr room.
