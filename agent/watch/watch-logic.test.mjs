// Run: node --test agent/watch/
//
// Pins the watcher's decision core: the emotion→class map is total and
// refuses strangers; ALERT entry needs 2 consecutive polls while glitch fires
// on first sight; a stuck class re-alerts on its leash (12h/6h) and exits
// with one recovery; milestone crossings fire once per crossing with
// hysteresis in both directions; quiet hours queue delivery but confused
// pierces. All of it clockless — `now` is handed in, so every scenario here
// replays identically forever.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EMOTION_CLASS,
  REALERT_MS,
  classOf,
  decide,
  gate,
  initialState,
  inQuietHours,
  parseQuietHours,
  parseState,
  renderMessage,
  serializeState,
} from './watch-logic.mjs'

const NOW = 1_754_650_000_000
const HOUR = 3_600_000

/** Shorthand poll — wellbeing defaults to a milestone-neutral 50. */
const poll = (emotion, wellbeing = 50) => ({ emotion, wellbeing })

/** Run a sequence of polls 15 min apart; returns every action, tagged by step. */
function run(polls, start = initialState(NOW)) {
  let state = start
  const all = []
  polls.forEach((p, i) => {
    const r = decide(state, p, NOW + i * 15 * 60_000)
    state = r.state
    all.push(...r.actions.map((a) => ({ ...a, step: i })))
  })
  return { state, actions: all }
}

// ── class mapping ───────────────────────────────────────────────────────────

test('every emotion maps to its class; unknown emotions are refused', () => {
  assert.equal(classOf('angry'), 'ALERT')
  assert.equal(classOf('alert'), 'ALERT')
  assert.equal(classOf('confused'), 'ALERT')
  assert.equal(classOf('glitch'), 'DEAD_AIR')
  assert.equal(classOf('sad'), 'SOFT')
  assert.equal(classOf('sleepy'), 'SOFT')
  assert.equal(classOf('neutral'), 'OK')
  assert.equal(classOf('happy'), 'OK')
  assert.equal(classOf('love'), 'OK')
  // The map is exactly the 12-emotion face family minus the three the server
  // never emits as a verdict — nothing extra hiding in it.
  assert.equal(Object.keys(EMOTION_CLASS).length, 9)
  assert.throws(() => classOf('ecstatic'), /unknown emotion/)
  assert.throws(() => classOf('toString'), /unknown emotion/)
})

// ── ALERT debounce ──────────────────────────────────────────────────────────

test('one ALERT poll says nothing; the second consecutive one alerts', () => {
  const first = decide(initialState(NOW), poll('angry'), NOW)
  assert.deepEqual(first.actions, [])
  assert.equal(first.state.cls, 'OK') // no edge yet
  assert.equal(first.state.pending, 'ALERT')

  const second = decide(first.state, poll('angry'), NOW + 15 * 60_000)
  assert.equal(second.actions.length, 1)
  assert.deepEqual(second.actions[0], { kind: 'alert', cls: 'ALERT', emotion: 'angry' })
  assert.equal(second.state.cls, 'ALERT')

  // Third poll in the same class: silence — edge-triggered, not level-triggered.
  const third = decide(second.state, poll('angry'), NOW + 30 * 60_000)
  assert.deepEqual(third.actions, [])
})

test('a lapsed ALERT sighting is forgotten — consecutive means consecutive', () => {
  const { actions } = run([poll('angry'), poll('happy'), poll('angry')])
  assert.deepEqual(actions, []) // never two in a row, never a message
})

test('glitch fires on first sight — STALE_MS already debounced it server-side', () => {
  const r = decide(initialState(NOW), poll('glitch'), NOW)
  assert.equal(r.actions.length, 1)
  assert.deepEqual(r.actions[0], { kind: 'alert', cls: 'DEAD_AIR', emotion: 'glitch' })
  assert.equal(r.state.cls, 'DEAD_AIR')
})

test('glitch fires immediately even out of a confirmed ALERT', () => {
  const { state } = run([poll('angry'), poll('angry')]) // confirmed ALERT
  const r = decide(state, poll('glitch'), NOW + HOUR)
  assert.deepEqual(r.actions, [{ kind: 'alert', cls: 'DEAD_AIR', emotion: 'glitch' }])
})

// ── recovery on class exit ──────────────────────────────────────────────────

test('leaving ALERT sends one recovery; SOFT↔OK moves stay silent', () => {
  const { state } = run([poll('angry'), poll('angry')])
  const rec = decide(state, poll('happy'), NOW + HOUR)
  assert.deepEqual(rec.actions, [{ kind: 'recovery', cls: 'OK', emotion: 'happy' }])
  assert.equal(rec.state.cls, 'OK')

  // OK → SOFT → OK: the face may sulk, the phone says nothing.
  const soft = run([poll('sad'), poll('sleepy'), poll('happy')])
  assert.deepEqual(soft.actions, [])
})

test('DEAD_AIR resolving into ALERT alerts (no recovery — it is not recovered)', () => {
  const dead = decide(initialState(NOW), poll('glitch'), NOW)
  // Probe returns with an angry verdict: normal 2-poll ALERT entry.
  const s1 = decide(dead.state, poll('angry'), NOW + HOUR)
  assert.deepEqual(s1.actions, [])
  const s2 = decide(s1.state, poll('angry'), NOW + HOUR + 15 * 60_000)
  assert.deepEqual(s2.actions, [{ kind: 'alert', cls: 'ALERT', emotion: 'angry' }])
})

// ── re-alert leashes ────────────────────────────────────────────────────────

test('a stuck ALERT repeats itself after 12h, not before', () => {
  const { state } = run([poll('angry'), poll('angry')])
  const early = decide(state, poll('angry'), state.lastSend + REALERT_MS.ALERT - 1)
  assert.deepEqual(early.actions, [])
  const due = decide(state, poll('angry'), state.lastSend + REALERT_MS.ALERT)
  assert.deepEqual(due.actions, [{ kind: 're-alert', cls: 'ALERT', emotion: 'angry' }])
  // And the leash resets: the re-alert is now the last send.
  assert.equal(due.state.lastSend, state.lastSend + REALERT_MS.ALERT)
})

test('a stuck DEAD_AIR repeats itself after 6h', () => {
  const dead = decide(initialState(NOW), poll('glitch'), NOW)
  const early = decide(dead.state, poll('glitch'), NOW + REALERT_MS.DEAD_AIR - 1)
  assert.deepEqual(early.actions, [])
  const due = decide(dead.state, poll('glitch'), NOW + REALERT_MS.DEAD_AIR)
  assert.deepEqual(due.actions, [{ kind: 're-alert', cls: 'DEAD_AIR', emotion: 'glitch' }])
})

// ── milestone hysteresis ────────────────────────────────────────────────────

test('falling through 30 pings once; re-arms only above 40', () => {
  const seq = run([
    poll('neutral', 35), // above the line: nothing
    poll('sad', 29), //     crossed down: somber
    poll('sad', 25), //     still down: silence (disarmed)
    poll('neutral', 35), // back up but under 40: still disarmed
    poll('neutral', 41), // re-armed
    poll('sad', 28), //     second genuine crossing: somber again
  ])
  const somber = seq.actions.filter((a) => a.kind === 'somber')
  assert.equal(somber.length, 2)
  assert.deepEqual(somber.map((a) => a.step), [1, 5])
})

test('rising through 80 celebrates once; re-arms only below 60', () => {
  const seq = run([
    poll('happy', 79), //  under the line: nothing
    poll('love', 80), //   crossed up: celebration (the love line is ≥80)
    poll('love', 92), //   still up: silence
    poll('happy', 65), //  dipped but not under 60: still disarmed
    poll('happy', 59), //  re-armed
    poll('love', 81), //   second genuine crossing
  ])
  const parties = seq.actions.filter((a) => a.kind === 'celebration')
  assert.equal(parties.length, 2)
  assert.deepEqual(parties.map((a) => a.step), [1, 5])
})

test('a null wellbeing fires no milestone — no number, no news', () => {
  const r = decide(initialState(NOW), { emotion: 'neutral', wellbeing: null }, NOW)
  assert.deepEqual(r.actions, [])
  assert.equal(r.state.downArmed, true)
  assert.equal(r.state.upArmed, true)
})

// ── quiet hours ─────────────────────────────────────────────────────────────

test('QUIET_HOURS "23-08" wraps midnight; "00-00" is never quiet', () => {
  const q = parseQuietHours('23-08')
  assert.equal(inQuietHours(23, q), true)
  assert.equal(inQuietHours(3, q), true)
  assert.equal(inQuietHours(7, q), true)
  assert.equal(inQuietHours(8, q), false) // end hour is already morning
  assert.equal(inQuietHours(12, q), false)
  const never = parseQuietHours('00-00')
  for (let h = 0; h < 24; h++) assert.equal(inQuietHours(h, never), false)
  assert.throws(() => parseQuietHours('bedtime'), /not H-H/)
  assert.throws(() => parseQuietHours('23-25'), /past 23/)
})

test('quiet hours queue alerts for morning; confused pierces', () => {
  const angry = { kind: 'alert', cls: 'ALERT', emotion: 'angry' }
  const drowning = { kind: 'alert', cls: 'ALERT', emotion: 'confused' }
  const somber = { kind: 'somber', cls: 'SOFT', emotion: 'sad' }

  const day = gate([angry, drowning, somber], false)
  assert.deepEqual(day, { send: [angry, drowning, somber], queue: [] })

  const night = gate([angry, drowning, somber], true)
  assert.deepEqual(night.send, [drowning]) // only the flood gets through
  assert.deepEqual(night.queue, [angry, somber])
})

// ── state round-trip ────────────────────────────────────────────────────────

test('state survives serialize→parse; garbage is refused', () => {
  const s = { cls: 'ALERT', since: NOW, lastSend: NOW + 5, pending: '', downArmed: false, upArmed: true }
  assert.deepEqual(parseState(serializeState(s)), s)
  // The first three fields are the promised v2 shape: class|since|last_send.
  assert.match(serializeState(s), /^ALERT\|\d+\|\d+\|/)
  assert.throws(() => parseState('OK|123'), /is not/)
  assert.throws(() => parseState('MEH|1|2||1|1'), /unknown/)
  assert.throws(() => parseState('OK|x|2||1|1'), /non-numeric/)
})

// ── messages quote the server verbatim ──────────────────────────────────────

test('rendered messages carry the headline and numbers digit for digit', () => {
  const p = {
    emotion: 'angry',
    wellbeing: 23.456789,
    headline: 'You forgot me.',
    latest: { moisture: 12.3, soilTemp: 21.7, ec: 1.15, ph: 6.3, ts: NOW },
  }
  const msg = renderMessage({ kind: 'alert', cls: 'ALERT', emotion: 'angry' }, p)
  assert.match(msg, /"You forgot me\."/)
  assert.match(msg, /23\.456789\/100/) // verbatim, not rounded
  assert.match(msg, /12\.3%/)
  assert.match(msg, /1\.15 mS\/cm/)
  // Every kind renders; an unknown kind refuses rather than improvising.
  for (const kind of ['re-alert', 'recovery', 'somber', 'celebration']) {
    assert.equal(typeof renderMessage({ kind, cls: 'ALERT', emotion: 'angry' }, p), 'string')
  }
  assert.throws(() => renderMessage({ kind: 'gossip', cls: 'OK', emotion: 'happy' }, p), /unknown action kind/)
})
