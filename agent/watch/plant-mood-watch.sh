#!/usr/bin/env bash
# plant-mood-watch — the deterministic alert path (plan T3.4, cron */15).
#
# Polls PLANT_API_URL/api/readings?device_token=…&latest=1 and hands the
# verdict to watch-logic.mjs, which decides WHAT to say and WHEN (edge
# triggers, ALERT debounce, re-alert leashes, milestone hysteresis, quiet
# hours). This script owns only the plumbing: curl, the state file, the
# morning queue, and delivery. No LLM composes anything here — the templates
# are fixed PT-BR strings quoting the server's own headline and numbers.
#
# Env:
#   PLANT_API_URL        default http://localhost:3000
#   PLANT_DEVICE_TOKEN   required
#   STATE_FILE           default ~/.plant-mood-watch.state
#                        (v2-style: class|since|last_send|…; queue sits beside
#                        it as $STATE_FILE.queue, one JSON string per line)
#   QUIET_HOURS          default 23-08 (queue alerts until morning; a
#                        `confused` alert pierces — flooding cannot wait)
#   TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID
#                        transport; when either is unset, messages print to
#                        stdout instead (dev mode)
#   TEST=1               send one test message, touch NO state, exit
#
# API unreachable or non-200 → explicit error on stderr, exit 1. An unpaired
# token (no readings yet) is not an alarm: noted on stderr, exit 0 — DEAD_AIR
# is for probes that went quiet, not probes that never spoke.

set -euo pipefail

API="${PLANT_API_URL:-http://localhost:3000}"
TOKEN="${PLANT_DEVICE_TOKEN:?PLANT_DEVICE_TOKEN must be set}"
STATE_FILE="${STATE_FILE:-$HOME/.plant-mood-watch.state}"
QUEUE_FILE="$STATE_FILE.queue"
QUIET_HOURS="${QUIET_HOURS:-23-08}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGIC="$HERE/watch-logic.mjs"

# One message out the door: Telegram when both halves are configured, stdout
# otherwise. Plain sendMessage — no parse_mode, so the server's verbatim
# headline can never break the markup.
send() {
  local text="$1"
  if [[ -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${TELEGRAM_CHAT_ID:-}" ]]; then
    curl -fsS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=${text}" >/dev/null
  else
    printf '%s\n' "$text"
  fi
}

# TEST=1 proves the transport and nothing else: no fetch, no state, no queue.
if [[ "${TEST:-0}" == "1" ]]; then
  send "🌱 plant-mood-watch: mensagem de teste — transporte OK, estado intocado."
  exit 0
fi

# ── poll ────────────────────────────────────────────────────────────────────

url="${API}/api/readings?device_token=${TOKEN}&latest=1"
if ! body="$(curl -fsS "$url")"; then
  echo "plant-mood-watch: GET $url failed — API unreachable or non-200" >&2
  exit 1
fi

if [[ "$(jq -r '.paired' <<<"$body")" != "true" ]]; then
  echo "plant-mood-watch: token unpaired (no readings yet) — nothing to watch" >&2
  exit 0
fi

# ── decide ──────────────────────────────────────────────────────────────────

state=""
[[ -f "$STATE_FILE" ]] && state="$(cat "$STATE_FILE")"
now_ms=$(( $(date +%s) * 1000 ))
hour="$(date +%H)"

out="$(node "$LOGIC" step "$state" "$body" "$now_ms" "$QUIET_HOURS" "$hour")"

# ── deliver ─────────────────────────────────────────────────────────────────

# Morning flush FIRST: messages queued overnight go out in the order they were
# decided, so a night that went alert→recovery tells its story in sequence.
in_quiet="$(jq -r '.inQuiet' <<<"$out")"
if [[ "$in_quiet" != "true" && -s "$QUEUE_FILE" ]]; then
  while IFS= read -r line; do
    send "$(jq -r '.' <<<"$line")"
  done <"$QUEUE_FILE"
  : >"$QUEUE_FILE"
fi

# Tonight's sends and queues. Each message travels as one JSON string per
# line (jq -c), so newlines inside a template can never split a message.
while IFS= read -r line; do
  [[ -n "$line" ]] && send "$(jq -r '.' <<<"$line")"
done < <(jq -c '.send[]' <<<"$out")

while IFS= read -r line; do
  [[ -n "$line" ]] && printf '%s\n' "$line" >>"$QUEUE_FILE"
done < <(jq -c '.queue[]' <<<"$out")

# State last: a delivery that died above leaves the old state, and the next
# run re-decides from the same edge rather than losing a transition.
printf '%s\n' "$(jq -r '.state' <<<"$out")" >"$STATE_FILE"
