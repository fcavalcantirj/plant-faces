# T3.1 — Plant agent on brownet: standup runbook (PREP ONLY)

This document PREPARES the Hermes plant-agent deployment on the brownet Pi 5.
Nothing here has been executed against brownet; it is the runbook Felipe (or a
deploy-window session) follows. Every config key below was read from a real
source file in `~/dev/dasbrow-hermes-coder` or `~/dev/felipe/claude-faces` —
the citation sits next to each field. Values marked **[FELIPE]** must be
supplied by him; none of them may ever be committed to this repo.

Plan of record: `~/.claude/plans/study-research-and-repo-soft-falcon.md`
(WAVE 3, T3.1 · decision #4: agent on brownet, LLM = any OpenAI-compatible
endpoint starting with Groq · decision #5: direct bot DM, Felipe creates the
bot).

---

## 1 · Shape: ONE process, two fronts

One `hermes gateway run` process hosts BOTH the Telegram bot and the
OpenAI-compatible `api_server` — the api_server is an **in-process gateway
platform, not a separate daemon**, so the talking face and Telegram share the
same brain, memory, and sessions. Source:
`claude-faces/skill/agent-face/references/backends.md` §"hermes: standing up
the api_server" — the "Shared memory (the real 'answers as me')" route: add
the `API_SERVER_*` env to the running gateway's `~/.hermes/.env` and restart
that one gateway; never start a second gateway on the same profile (pid lock
refuses).

The enable mechanism in the engine itself: a usable `API_SERVER_KEY`
(min 16 chars) in the environment turns the platform on —
`hermes/gateway/config.py:2131-2156` ("Require a usable key…"), same strength
bar as the startup guard in `hermes/gateway/platforms/api_server.py`
(`min_length=16` at line 1656). Defaults: `DEFAULT_HOST = "127.0.0.1"`,
`DEFAULT_PORT = 8642` (`hermes/gateway/platforms/api_server.py:150-151`).

## 2 · Prereqs on brownet (Pi 5, beside Claudius — separate process, separate user)

brownet already hosts Claudius (untouched, per the plan's standing
invariants). The dasbrow pattern isolates each agent under its own unix user
with lingering systemd — mirror it:

```bash
# as root, once                        # source: deploy/box-bootstrap.sh:56-58
useradd -m -s /bin/bash plantbot       # BOX_USER pattern (env.template:6)
loginctl enable-linger plantbot        # user units survive logout/reboot
```

Vendor the engine exactly like the fleet does — rsync the repo's `hermes/`
into `~/.hermes/hermes-agent/` and build the venv
(source: `deploy/box-bootstrap.sh:79-86`):

```bash
rsync -a --delete --exclude venv --exclude node_modules \
  <dasbrow-hermes-coder checkout>/hermes/ /home/plantbot/.hermes/hermes-agent/
chown -R plantbot:plantbot /home/plantbot/.hermes/hermes-agent
# as plantbot:
cd ~/.hermes/hermes-agent && python3 -m venv venv && venv/bin/pip install -e .
```

(The fleet installs `-e '.[claude-agent-sdk]'` because its brains run on the
Claude SDK — `box-bootstrap.sh:85`. The plant runs an OpenAI-wire provider, so
plain `-e .` suffices; add the extra only if the SDK fallback lane in §5 is
ever used.)

Node.js is also required on the box: the deterministic tools are an `.mjs`
CLI (§6).

## 3 · Config files

### 3a · `~/.hermes/config.yaml`

Config home proven by the fleet: `deploy/box-bootstrap.sh:112` installs
`deploy/templates/config.yaml` to `$HOMEDIR/.hermes/config.yaml`; the engine's
own example says the same ("Copy settings from this example into
`~/.hermes/config.yaml`", `hermes/cli-config.yaml.example:2-3`). Minimum
plant-agent config:

```yaml
# Groq is "any other OpenAI-compatible endpoint" to Hermes — provider
# "custom" + base_url. Source: hermes/cli-config.yaml.example:53-64
# ("custom" — Any other OpenAI-compatible endpoint. Set base_url below.)
model:
  provider: "custom"
  base_url: "https://api.groq.com/openai/v1"   # claude-faces/lib/providers/groq.ts:62
  default: "llama-3.1-8b-instant"              # [FELIPE] model choice — see §5 before changing

# Telegram platform knobs (shape: hermes/cli-config.yaml.example:1020-1041,
# the `platforms: telegram:` block). Token itself is env-only (§3b).
# platforms:
#   telegram:
#     reply_to_mode: "first"

# Gateway/messaging sessions execute terminal commands in terminal.cwd
# (hermes/cli-config.yaml.example:229-232) — point it at the tools dir so
# `node tools/plant.mjs status` resolves (§6).
terminal:
  backend: "local"
  cwd: "/home/plantbot/plant-agent"
```

Optional, same file: `platforms.api_server.extra.{key,port,host,model_routes}`
is the YAML route to the same api_server settings
(`hermes/cli-config.yaml.example:733-759`); we use the env route instead (§3b)
so all secrets live in one mode-600 file.

### 3b · `~/.hermes/.env` (mode 600 — the ONLY place secrets live)

The fleet writes exactly this file at `deploy/box-bootstrap.sh:114-124`
(mode 600). Keys and where each is read in the engine:

```bash
# ── Telegram front ───────────────────────────────────────────────────
TELEGRAM_BOT_TOKEN=            # [FELIPE] pending his BotFather run (plan decision #5).
                               #   Read at hermes/gateway/config.py:584,1838
TELEGRAM_ALLOWED_USERS=        # [FELIPE] his Telegram user id (comma list).
                               #   Allowlist env: hermes/gateway/authz_mixin.py:508
TELEGRAM_HOME_CHANNEL=         # [FELIPE] chat id for proactive sends (usually his id).
                               #   Read at hermes/gateway/config.py:1858
TELEGRAM_HOME_CHANNEL_NAME="Felipe DM"   # hermes/gateway/config.py:1863

# ── Brain: Groq as OpenAI-compatible endpoint ────────────────────────
OPENAI_API_KEY=                # [FELIPE] his GROQ_API_KEY value goes HERE — the
                               #   custom provider reads OPENAI_API_KEY/OPENAI_BASE_URL
                               #   (hermes/hermes_cli/main.py:982-992: "OPENAI_BASE_URL
                               #   alone counts — local models…")
OPENAI_BASE_URL=https://api.groq.com/openai/v1
GROQ_API_KEY=                  # [FELIPE] same key AGAIN under its own name — this one
                               #   feeds voice-note STT ("groq (free tier)… Set the
                               #   corresponding API key in .env: GROQ_API_KEY",
                               #   hermes/cli-config.yaml.example:1049-1050)

# ── api_server front (the talking face's door) ───────────────────────
API_SERVER_KEY=                # [FELIPE] generate: openssl rand -hex 24. Min 16 chars
                               #   or the platform stays off (gateway/config.py:2131-2156)
API_SERVER_HOST=               # [FELIPE] deliberate choice — default 127.0.0.1
                               #   (api_server.py:150) is loopback-only; the face on
                               #   another machine needs the tailnet IP or 0.0.0.0
                               #   ("tunnel or bind wider yourself, deliberately" —
                               #   backends.md §hermes-serve notes)
API_SERVER_PORT=8642           # default anyway (api_server.py:151); pin it explicitly

# ── Plant tools (§6) ─────────────────────────────────────────────────
PLANT_API_BASE=                # [FELIPE] the deployed plant-faces web URL
PLANT_DEVICE_TOKEN=            # [FELIPE] the pepper's source token (minted via
                               #   POST /api/devices with PLANTFACES_ADMIN_KEY — key
                               #   lives in plant-faces/.env.archive.local, NEVER here
                               #   by value)
```

### 3c · SOUL (persona)

Persona file for the generic engine lives at `~/.hermes/SOUL.md` — the CLI
seeds/upgrades exactly that path (`soul_path = home / "SOUL.md"`,
`hermes/hermes_cli/config.py:848`). Install:

```bash
install -m 644 <plant-faces>/agent/soul/SOUL.pepper.md /home/plantbot/.hermes/SOUL.md
```

(The fleet's `HERMES_CLAUDE_SDK_APPEND_FILE=$HOME/.dasbrowcoder/SOUL.md` at
`deploy/box-bootstrap.sh:121` is the Claude-SDK-provider variant of the same
idea — only relevant if the fallback lane of plan decision #4 (Agent SDK
bridge) is ever activated; config twin: `agent.claude_agent_sdk.append_file`,
`hermes/cli-config.yaml.example:816-818`.)

## 4 · systemd user unit skeleton

Adapted from `deploy/templates/hermes-gateway.service.template` (whole file —
ExecStart/WorkingDirectory/HERMES_HOME/Restart semantics are its lines 8-16;
unit name changed so it never collides with fleet tooling that greps
`hermes-gateway`):

```ini
# /home/plantbot/.config/systemd/user/plant-agent.service
[Unit]
Description=Plant agent gateway - Telegram + api_server, one brain
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
ExecStart=/home/plantbot/.hermes/hermes-agent/venv/bin/python -m hermes_cli.main gateway run
WorkingDirectory=/home/plantbot/.hermes
Environment="HERMES_HOME=/home/plantbot/.hermes"
Environment="VIRTUAL_ENV=/home/plantbot/.hermes/hermes-agent/venv"
Restart=always
RestartSec=5
RestartForceExitStatus=75
KillMode=mixed
KillSignal=SIGTERM
TimeoutStopSec=90
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
```

Enable exactly like the fleet (`deploy/box-bootstrap.sh:205-207`):

```bash
systemctl --user daemon-reload && systemctl --user enable --now plant-agent
systemctl --user is-active plant-agent
```

(Template's `ExecStopPost=…gateway.cgroup_cleanup` is fleet hygiene for heavy
terminal use; harmless to keep, omitted from the skeleton for clarity.)

## 5 · Model choice — the Groq rate-limit warning, verbatim concern

From `claude-faces/CLAUDE.md:37-56` ("Provider rate limits — read the doc,
never recall from memory"): Groq limits are **organization-level**, shared
with every other consumer of that account including dev machines;
`llama-3.3-70b-versatile` had **1K requests/day** (one client at its 30 RPM
ceiling exhausts a whole day in ~35 minutes) while `llama-3.1-8b-instant`
had **14.4K RPD** — 14× more. Those numbers were last verified 2026-07-24;
**re-fetch <https://console.groq.com/docs/rate-limits.md> before deciding**,
per that doc's own rule. Hosted Whisper STT is metered separately in
audio-seconds on the same org budget.

Recommendation (Felipe confirms): start on `llama-3.1-8b-instant`; the plant's
replies are tool-grounded and short, so the small model's RPD headroom matters
more than its size. Swapping later is one `model.default` edit (§3a) — that's
the whole point of the OpenAI-compatible seam.

## 6 · How the plant tools mount

`agent/tools/plant.mjs` (T3.2, its own lane — may land in parallel with this
doc) is a deterministic CLI: `plant status|history|care|climate|profile|stats`,
each subcommand printing live server JSON from the plant-faces API and nothing
else. The seams it reads are already live in this repo:
`GET /api/readings?device_token=…[&latest=1][&stats=1]`
(`web/app/api/readings/route.ts:1`, `:50-55`).

Mount = the hermes **terminal toolset**, not a plugin:

- Install the tools dir on the box (e.g. `/home/plantbot/plant-agent/tools/`)
  and point `terminal.cwd` at its parent (§3a). Gateway sessions run terminal
  commands in that cwd (`hermes/cli-config.yaml.example:229-232`).
- Telegram's default preset `hermes-telegram` already includes the terminal
  toolset (`platform_toolsets` defaults, `hermes/cli-config.yaml.example:
  989-1012`), so both fronts can run `node tools/plant.mjs status`.
- The SOUL's grounding rules close the loop: a terminal invocation's stdout IS
  "a tool output of this turn", and the agent may quote numbers from nowhere
  else. No computation happens in the agent — plant.mjs prints server JSON,
  the server computed it, the persona reads it aloud.
- Later hardening (optional, not T3.1): wrap plant.mjs as a stdio MCP server
  and register it under `mcp_servers:` (stdio shape — `command`/`args`/`env`:
  `deploy/templates/config.yaml:999-1012`), then strip `terminal` from the
  Telegram toolset so the plant can ONLY touch its own tools.

## 7 · Agent Faces Mode B — pointing the talking face at this agent

The face's agent-bridge contract, from
`claude-faces/skill/agent-face/references/backends.md` (Mode B table, lines
45-66, and the hermes section, lines 131-173). `.env.local` of the Agent Faces
app:

```bash
AGENT_BRIDGE_KIND=hermes            # backends.md:49 — Hermes api_server session flow
HERMES_API_BASE_URL=                # [FELIPE] http://<brownet tailnet IP or MagicDNS name>:8642
                                    #   (alias of AGENT_BRIDGE_URL — backends.md:61)
HERMES_API_KEY=                     # [FELIPE] same value as API_SERVER_KEY from §3b
                                    #   (alias of AGENT_BRIDGE_KEY — backends.md:62)
SELF_HOST=1                         # private-network URL allowed (backends.md:88-91);
                                    #   on Vercel instead: ALLOW_AGENT_BRIDGE_IN_PROD=1
                                    #   + a public HTTPS/tunnel URL (backends.md:91-93)
```

Wire behavior to expect (field-verified notes, backends.md:163-173): one
OpenAI-shaped `POST /v1/chat/completions` per turn, `Authorization: Bearer`,
model id `hermes-agent`; the session id rides the `X-Hermes-Session-Id`
**response header** and is echoed back on later turns — the agent's own memory
carries the thread, so the face never resends history or a system prompt. The
Mode B option only appears in the face's picker when the endpoint is reachable
(backends.md:95-96) — which is why §3b's `API_SERVER_HOST` must be a deliberate
non-loopback bind for a face running on another machine.

## 8 · Everything Felipe must supply (nothing deploys without these)

| Value | Where it goes | Status |
|---|---|---|
| Telegram bot token (BotFather) | `TELEGRAM_BOT_TOKEN`, §3b | **pending his BotFather run** |
| His Telegram user id | `TELEGRAM_ALLOWED_USERS` + `TELEGRAM_HOME_CHANNEL`, §3b | pending |
| Groq API key | `OPENAI_API_KEY` + `GROQ_API_KEY`, §3b | pending |
| Model choice (after re-reading the rate-limit doc, §5) | `model.default`, §3a | recommended `llama-3.1-8b-instant`, his call |
| `API_SERVER_KEY` (generate, ≥16 chars) | §3b + face's `HERMES_API_KEY`, §7 | pending |
| brownet bind decision (tailnet IP vs 0.0.0.0) | `API_SERVER_HOST`, §3b | pending |
| The plant's name | `agent/soul/SOUL.pepper.md` header | **PLACEHOLDER — Felipe decides** |
| Pepper's source token (mint with `PLANTFACES_ADMIN_KEY` — value never leaves `.env.archive.local`) | `PLANT_DEVICE_TOKEN`, §3b | pending |
| Deployed web app URL | `PLANT_API_BASE`, §3b | pending |
| brownet SSH window for the actual standup | — | **this doc does not touch brownet** |

## 9 · Verification (T3.1 DoD, run at standup — not now)

1. `curl -s http://<host>:8642/health` answers (endpoint list:
   `hermes/gateway/platforms/api_server.py:5` region; `GET /health` named in
   backends.md:137).
2. PONG both fronts: `curl -s http://<host>:8642/v1/chat/completions -H
   "Authorization: Bearer $API_SERVER_KEY" -d '{"model":"hermes-agent",
   "messages":[{"role":"user","content":"PONG?"}]}'` answers in persona; the
   same question in the Telegram DM answers from the same brain.
3. Reboot the Pi: `systemctl --user is-active plant-agent` returns `active`
   (linger, §2).
4. Grounding smoke: ask for a number with the web API stopped — the reply must
   be "não estou sentindo minhas raízes", never a digit (SOUL rule 3; full
   adversarial suite is T3.6).
