#!/usr/bin/env node
// Watch logic — the deterministic core of plant-mood-watch.sh (plan T3.4),
// extracted so `node --test` can pin every decision the watcher makes.
//
// Pure functions only: no clock, no fs, no network. The shell script owns
// curl, the state file, the queue file and Telegram; this file owns WHAT to
// say and WHEN. Same inputs, same messages, forever.
//
// Emotion classes:
//   ALERT    {angry, alert, confused} — acute, message-worthy
//   DEAD_AIR {glitch}                 — the node went silent
//   SOFT     {sad, sleepy}            — uncomfortable but slow; stays silent
//   OK       {neutral, happy, love}   — nothing to say
//
// Edge-triggered: one message per class TRANSITION, not per poll. Entry into
// ALERT takes 2 consecutive polls — one flappy reading is not an emergency —
// but glitch fires on first sight, because the server only declares glitch
// after STALE_MS (90 min) of silence: the debounce already happened there.
// A class that stays bad re-alerts on a long leash (12h ALERT, 6h DEAD_AIR),
// and leaving an alerting class sends one recovery message. SOFT↔OK moves
// are silent by design: sad is the face's job, not the phone's.
//
// Wellbeing milestones ride the same polls with hysteresis: falling through
// 30 pings once and re-arms above 40; rising through 80 celebrates once and
// re-arms below 60 — a value oscillating on a threshold cannot spam. The
// thresholds mirror the mood engine's own lines (wellbeing <30 reads "still
// hurting", ≥80 reads love) so the phone and the face agree.
//
// Quiet hours gate DELIVERY, never the decision: the state machine advances
// normally at night, but messages queue for morning — except a `confused`
// alert (drowning roots do not wait for breakfast).
//
// When run directly (the shell's entry point):
//   node watch-logic.mjs step <state|''> <latestBodyJson> <nowMs> <quietSpec> <hour>
// prints {"state": "...", "inQuiet": bool, "send": [...], "queue": [...]}.

// ── class mapping ───────────────────────────────────────────────────────────

export const EMOTION_CLASS = {
  angry: 'ALERT',
  alert: 'ALERT',
  confused: 'ALERT',
  glitch: 'DEAD_AIR',
  sad: 'SOFT',
  sleepy: 'SOFT',
  neutral: 'OK',
  happy: 'OK',
  love: 'OK',
}

/** Unknown emotions are refused, not guessed into a class. */
export function classOf(emotion) {
  // Object.hasOwn, as everywhere in this repo: "toString" is unknown.
  if (!Object.hasOwn(EMOTION_CLASS, emotion)) {
    throw new Error(`unknown emotion "${emotion}" — refusing to classify`)
  }
  return EMOTION_CLASS[emotion]
}

// ── constants the tests pin ─────────────────────────────────────────────────

const HOUR_MS = 3_600_000

/** How long a stuck bad class stays quiet before repeating itself. */
export const REALERT_MS = {
  ALERT: 12 * HOUR_MS,
  DEAD_AIR: 6 * HOUR_MS,
}

/** Wellbeing milestone thresholds — fire lines match plant-mood.ts's own. */
export const MILESTONE = {
  down: { fire: 30, rearm: 40 }, // fires strictly below 30, re-arms strictly above 40
  up: { fire: 80, rearm: 60 }, // fires at ≥80 (the love line), re-arms strictly below 60
}

// ── state ───────────────────────────────────────────────────────────────────
//
// v2-style pipe format, first three fields exactly class|since|last_send:
//   cls|since|lastSend|pending|downArmed|upArmed
// pending is '' or 'ALERT' (the one class that debounces); armed flags are
// 1/0. A first run has no state: initialState assumes an OK baseline, so an
// already-angry plant alerts after the normal two sightings and an
// already-thriving one celebrates once — meeting the plant counts as the
// crossing.

export function initialState(now) {
  return { cls: 'OK', since: now, lastSend: 0, pending: '', downArmed: true, upArmed: true }
}

export function serializeState(s) {
  return [s.cls, s.since, s.lastSend, s.pending, s.downArmed ? 1 : 0, s.upArmed ? 1 : 0].join('|')
}

/** A state file that no longer parses is refused loudly, never guessed around. */
export function parseState(str) {
  const parts = String(str).trim().split('|')
  if (parts.length !== 6) throw new Error(`state "${str}" is not cls|since|lastSend|pending|downArmed|upArmed`)
  const [cls, since, lastSend, pending, down, up] = parts
  if (!['ALERT', 'DEAD_AIR', 'SOFT', 'OK'].includes(cls)) throw new Error(`state class "${cls}" unknown`)
  if (!Number.isFinite(Number(since)) || !Number.isFinite(Number(lastSend))) {
    throw new Error(`state "${str}" carries non-numeric timestamps`)
  }
  if (pending !== '' && pending !== 'ALERT') throw new Error(`state pending "${pending}" unknown`)
  if (!['0', '1'].includes(down) || !['0', '1'].includes(up)) {
    throw new Error(`state "${str}" carries non-boolean armed flags`)
  }
  return {
    cls,
    since: Number(since),
    lastSend: Number(lastSend),
    pending,
    downArmed: down === '1',
    upArmed: up === '1',
  }
}

// ── the decision ────────────────────────────────────────────────────────────

/**
 * Advance the machine by one poll. `poll` is {emotion, wellbeing} — wellbeing
 * may be null (an unpaired token has none; null never fires a milestone).
 * Returns { state, actions } where each action is {kind, cls, emotion} and
 * kind ∈ alert | re-alert | recovery | somber | celebration. Delivery timing
 * (quiet hours) is gate()'s job, not this function's.
 */
export function decide(state, poll, now) {
  const cls = classOf(poll.emotion)
  const s = { ...state }
  const actions = []

  if (cls === s.cls) {
    // Same class: no edge. A half-seen ALERT that lapsed back is forgotten —
    // the debounce demands CONSECUTIVE sightings.
    s.pending = ''
    const leash = REALERT_MS[cls]
    if (leash !== undefined && now - s.lastSend >= leash) {
      actions.push({ kind: 're-alert', cls, emotion: poll.emotion })
      s.lastSend = now
    }
  } else if (cls === 'ALERT' && s.pending !== 'ALERT') {
    // First ALERT sighting: hold the edge, say nothing yet.
    s.pending = 'ALERT'
  } else {
    // Confirmed transition: second consecutive ALERT sighting, or any class
    // that does not debounce (glitch was pre-debounced by STALE_MS; exits
    // carry no false-alarm risk worth delaying).
    const from = s.cls
    s.cls = cls
    s.since = now
    s.pending = ''
    if (cls === 'ALERT' || cls === 'DEAD_AIR') {
      actions.push({ kind: 'alert', cls, emotion: poll.emotion })
      s.lastSend = now
    } else if (from === 'ALERT' || from === 'DEAD_AIR') {
      actions.push({ kind: 'recovery', cls, emotion: poll.emotion })
      s.lastSend = now
    }
  }

  // Milestones judge wellbeing, not class — they fire even mid-ALERT, because
  // "it crossed 30 on the way down" is news of its own.
  const w = poll.wellbeing
  if (typeof w === 'number') {
    if (s.downArmed && w < MILESTONE.down.fire) {
      actions.push({ kind: 'somber', cls, emotion: poll.emotion })
      s.downArmed = false
    } else if (!s.downArmed && w > MILESTONE.down.rearm) {
      s.downArmed = true
    }
    if (s.upArmed && w >= MILESTONE.up.fire) {
      actions.push({ kind: 'celebration', cls, emotion: poll.emotion })
      s.upArmed = false
    } else if (!s.upArmed && w < MILESTONE.up.rearm) {
      s.upArmed = true
    }
  }

  return { state: s, actions }
}

// ── quiet hours — delivery gating, decision untouched ───────────────────────

/** "23-08": start hour inclusive, end hour exclusive, may wrap midnight. */
export function parseQuietHours(spec) {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(spec ?? '')
  if (!m) throw new Error(`QUIET_HOURS "${spec}" is not H-H (e.g. "23-08")`)
  const start = Number(m[1])
  const end = Number(m[2])
  if (start > 23 || end > 23) throw new Error(`QUIET_HOURS "${spec}" names an hour past 23`)
  return { start, end }
}

export function inQuietHours(hour, q) {
  if (q.start === q.end) return false // zero-length window: never quiet
  return q.start < q.end ? hour >= q.start && hour < q.end : hour >= q.start || hour < q.end
}

/**
 * Split actions into deliver-now and queue-for-morning. Only a `confused`
 * alert pierces the night: flooding kills in hours, everything else keeps.
 */
export function gate(actions, quiet) {
  if (!quiet) return { send: actions, queue: [] }
  const send = []
  const queue = []
  for (const a of actions) {
    const pierces = a.emotion === 'confused' && (a.kind === 'alert' || a.kind === 're-alert')
    ;(pierces ? send : queue).push(a)
  }
  return { send, queue }
}

// ── PT-BR message templates — the server's words and numbers, verbatim ──────
//
// The persona around the numbers is Portuguese; the headline is quoted in the
// server's own voice and every number is the server's value stringified as-is
// (no rounding here — a template that rounds is a template that edits).

function numbersLine(poll) {
  const parts = []
  if (typeof poll.wellbeing === 'number') parts.push(`bem-estar ${poll.wellbeing}/100`)
  const l = poll.latest
  if (l) {
    parts.push(`umidade ${l.moisture}%`, `solo ${l.soilTemp}°C`, `EC ${l.ec} mS/cm`, `pH ${l.ph}`)
  }
  return parts.join(' · ')
}

const ALERT_HEAD = {
  angry: '🌱🚨 ALERTA — a planta está BRAVA',
  alert: '🌱⚠️ ALERTA — a planta pede atenção',
  confused: '🌱🌊 ALERTA — raízes afogando',
}

export function renderMessage(action, poll) {
  const quoted = poll.headline === undefined ? '' : ` Ela diz: "${poll.headline}".`
  const nums = numbersLine(poll)
  const tail = `${quoted}${nums ? ` ${nums}` : ''}`
  switch (action.kind) {
    case 'alert':
      if (action.cls === 'DEAD_AIR') {
        return `🌱📡 SEM SINAL — a sonda ficou muda (>90 min sem leitura).${tail}`
      }
      return `${ALERT_HEAD[action.emotion] ?? `🌱🚨 ALERTA — ${action.emotion}`} (${action.emotion}).${tail}`
    case 're-alert':
      if (action.cls === 'DEAD_AIR') {
        return `🌱🔁 AINDA SEM SINAL — a sonda segue muda.${tail}`
      }
      return `🌱🔁 AINDA EM ALERTA (${action.emotion}) — nada mudou desde o último aviso.${tail}`
    case 'recovery':
      return `🌱✅ RECUPEROU — saiu do alerta, agora ${action.emotion}.${tail}`
    case 'somber':
      return `🌱🕯️ Bem-estar cruzou 30 para baixo.${tail}`
    case 'celebration':
      return `🌱🎉 Bem-estar cruzou 80 para cima — dias muito bons.${tail}`
    default:
      throw new Error(`unknown action kind "${action.kind}" — refusing to invent a message`)
  }
}

// ── CLI: the shell's one entry point ────────────────────────────────────────

function cliFail(msg) {
  process.stderr.write(`watch-logic: ${msg}\n`)
  process.exit(1)
}

async function cliMain() {
  const [mode, stateStr, bodyJson, nowStr, quietSpec, hourStr] = process.argv.slice(2)
  if (mode !== 'step') {
    cliFail("usage: watch-logic.mjs step <state|''> <latestBodyJson> <nowMs> <quietSpec> <hour>")
  }
  let body
  try {
    body = JSON.parse(bodyJson)
  } catch {
    cliFail('poll body is not valid JSON')
  }
  if (body.paired !== true || !body.mood) {
    cliFail('unpaired token: no readings, no mood, nothing to watch')
  }
  const now = Number(nowStr)
  const hour = Number(hourStr)
  if (!Number.isFinite(now) || !Number.isFinite(hour)) cliFail('nowMs and hour must be numbers')

  const poll = {
    emotion: body.mood.emotion,
    wellbeing: body.wellbeing,
    headline: body.mood.headline,
    latest: body.latest,
  }
  const state = stateStr === '' || stateStr === undefined ? initialState(now) : parseState(stateStr)
  const { state: next, actions } = decide(state, poll, now)
  const quiet = inQuietHours(hour, parseQuietHours(quietSpec))
  const { send, queue } = gate(actions, quiet)
  process.stdout.write(
    `${JSON.stringify({
      state: serializeState(next),
      inQuiet: quiet,
      send: send.map((a) => renderMessage(a, poll)),
      queue: queue.map((a) => renderMessage(a, poll)),
    })}\n`,
  )
}

import { pathToFileURL } from 'node:url'
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await cliMain()
}
