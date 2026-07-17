// Run: pnpm test
//
// The mood engine and the ingestion gate are the only real logic in this app,
// so they are what is tested. Every assertion here was checked red-on-demand
// before being trusted green.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  axisComfort,
  comfortOf,
  deriveSeries,
  detectEvents,
  initialState,
  plantMood,
  stepState,
  STALE_MS,
  type PlantState,
  type SensorReading,
} from './plant-mood.ts'
import { speciesById, TRUST } from './species.ts'
import { parseIngest, toWire } from './ingest.ts'

const pothos = speciesById('pothos')
const HOUR = 3_600_000
const band = (key: string) => pothos.axes.find((a) => a.key === key)!.band

/** A reading that is perfect on every axis for pothos. */
function perfect(ts: number, over: Partial<SensorReading> = {}): SensorReading {
  return { moisture: 45, soilTemp: 23, ec: 1.2, ph: 6.3, ts, ...over }
}

function run(
  state: PlantState,
  make: (ts: number) => SensorReading,
  hours: number,
  stepH = 1,
): PlantState {
  let s = state
  for (let h = stepH; h <= hours; h += stepH) {
    s = stepState(s, make(s.ts + stepH * HOUR), pothos)
  }
  return s
}

// ── axis scoring ────────────────────────────────────────────────────────────

test('axisComfort: +1 at ideal, 0 at the band edges', () => {
  assert.equal(axisComfort(45, band('moisture')), 1)
  assert.equal(axisComfort(25, band('moisture')), 0)
  assert.equal(axisComfort(70, band('moisture')), 0)
})

test('axisComfort: falls negative past an edge and clamps at -1', () => {
  assert.ok(axisComfort(15, band('moisture')) < 0)
  assert.ok(axisComfort(85, band('moisture')) < 0)
  assert.equal(axisComfort(-500, band('moisture')), -1)
  assert.equal(axisComfort(500, band('moisture')), -1)
})

test('comfortOf: a perfect reading scores 1', () => {
  assert.ok(Math.abs(comfortOf(perfect(0), pothos) - 1) < 1e-9)
})

test('Liebig: one fatal axis is not outvoted by the happy ones', () => {
  // Perfect soil temp and EC, bone-dry moisture. A plain weighted average
  // scores this positive and the plant cheers up while dying of thirst.
  const parched = comfortOf(perfect(0, { moisture: 5 }), pothos)
  assert.ok(parched < 0, `bone-dry soil must read as suffering (got ${parched.toFixed(3)})`)
})

// ── graded trust ────────────────────────────────────────────────────────────

test('graded trust: a shaky EC cannot sink the score as hard as moisture can', () => {
  // Same relative severity on each axis: both pinned far past their floor.
  const dryOnly = comfortOf(perfect(0, { moisture: -100 }), pothos) // moisture trust 1.0
  const ecOnly = comfortOf(perfect(0, { ec: 0 }), pothos) // ec trust 0.6
  assert.ok(dryOnly < 0 && ecOnly < 0, 'both must register as bad')
  assert.ok(
    ecOnly > dryOnly,
    `EC (trust ${TRUST.ec}) must not out-punish moisture (trust ${TRUST.moisture}) — got ec ${ecOnly.toFixed(3)} vs moisture ${dryOnly.toFixed(3)}`,
  )
})

test('graded trust: EC still counts — it is damped, not ignored', () => {
  const salty = comfortOf(perfect(0, { ec: 6 }), pothos)
  assert.ok(salty < 0, `a salt-poisoned pot must score negative (got ${salty.toFixed(3)})`)
})

// ── pH is trend only ────────────────────────────────────────────────────────

test('pH NEVER moves the score, however wrong it is', () => {
  const good = comfortOf(perfect(0), pothos)
  const acid = comfortOf(perfect(0, { ph: 3.5 }), pothos)
  const alkaline = comfortOf(perfect(0, { ph: 9 }), pothos)
  assert.equal(acid, good, 'uncalibrated pH must not drive the verdict')
  assert.equal(alkaline, good, 'uncalibrated pH must not drive the verdict')
})

test('pH out of band is still REPORTED as a trend note', () => {
  const s = initialState(perfect(0), 90)
  const mood = plantMood(perfect(s.ts, { ph: 3.5 }), s, pothos)
  assert.notEqual(mood.emotion, 'sad', 'pH did not make it sad')
  assert.equal(mood.notes.length, 1, 'but the reading is not swallowed')
  assert.match(mood.notes[0], /trend only|uncalibrated/i)
})

test('a happy plant with fine pH carries no notes', () => {
  const s = initialState(perfect(0), 90)
  assert.deepEqual(plantMood(perfect(s.ts), s, pothos).notes, [])
})

// ── the face ladder ─────────────────────────────────────────────────────────

test('thirst escalates to anger only after the species runs out of patience', () => {
  const dry = (ts: number) => perfect(ts, { moisture: 10 })
  let s = initialState(dry(0), 70)
  s = run(s, dry, 24)
  assert.equal(plantMood(dry(s.ts), s, pothos).emotion, 'sad', '24h dry = thirsty, not angry')
  s = run(s, dry, 60) // ~84h total, past pothos' 72h patience
  assert.equal(plantMood(dry(s.ts), s, pothos).emotion, 'angry')
})

test('a thirsty cactus is not an angry cactus: patience is per-species', () => {
  const cactus = speciesById('cactus')
  const dry = (ts: number): SensorReading => ({ moisture: 2, soilTemp: 27, ec: 0.8, ph: 6.8, ts })
  let s = initialState(dry(0), 70)
  for (let h = 1; h <= 100; h++) s = stepState(s, dry(s.ts + HOUR), cactus)
  assert.equal(plantMood(dry(s.ts), s, cactus).emotion, 'sad')
})

test('drowning outranks the slow mood: a thriving plant reads queasy at once', () => {
  const s = initialState(perfect(0), 95)
  assert.equal(plantMood(perfect(s.ts, { moisture: 90 }), s, pothos).emotion, 'confused')
})

test('over-feeding reads as salt burn, not as thirst', () => {
  const s = initialState(perfect(0), 80)
  const mood = plantMood(perfect(s.ts, { ec: 2.6 }), s, pothos)
  assert.equal(mood.emotion, 'alert')
  assert.match(mood.reason, /salt|feeding/i)
})

test('a spent pot reads as hunger — the axis a moisture-only app cannot see', () => {
  const s = initialState(perfect(0), 80)
  const mood = plantMood(perfect(s.ts, { ec: 0.2 }), s, pothos)
  assert.equal(mood.emotion, 'sad')
  assert.match(mood.reason, /eat|feed|spent/i)
})

test('a stale reading is a glitch, never an invented mood', () => {
  const s = initialState(perfect(0), 90)
  const old = perfect(0)
  assert.equal(plantMood(old, s, pothos, old.ts + STALE_MS + 1).emotion, 'glitch')
})

test('a missing reading is a glitch', () => {
  const s = initialState(perfect(0), 90)
  assert.equal(plantMood(null, s, pothos).emotion, 'glitch')
})

// ── the accumulator ─────────────────────────────────────────────────────────

test('good care drifts the face up: neutral -> happy -> love', () => {
  let s = initialState(perfect(0), 40)
  assert.equal(plantMood(perfect(s.ts), s, pothos).emotion, 'neutral')
  s = run(s, perfect, 48)
  assert.equal(plantMood(perfect(s.ts), s, pothos).emotion, 'happy')
  s = run(s, perfect, 24 * 6)
  assert.equal(plantMood(perfect(s.ts), s, pothos).emotion, 'love')
})

test('harm lands faster than healing (asymmetric time constants)', () => {
  const dry = (ts: number) => perfect(ts, { moisture: 5 })
  const harmed = run(initialState(dry(0), 50), dry, 24)
  const damage = 50 - harmed.wellbeing
  const healed = run(initialState(perfect(0), 50), perfect, 24)
  const repair = healed.wellbeing - 50
  assert.ok(damage > 0 && repair > 0, 'both directions must move')
  assert.ok(
    damage > repair,
    `a day of drought must cost more than a day of care repays (harm ${damage.toFixed(1)} vs heal ${repair.toFixed(1)})`,
  )
})

test('watering an angry plant clears the anger but not the damage', () => {
  const dry = (ts: number) => perfect(ts, { moisture: 8 })
  let s = run(initialState(dry(0), 80), dry, 96)
  assert.equal(plantMood(dry(s.ts), s, pothos).emotion, 'angry')
  s = stepState(s, perfect(s.ts + HOUR), pothos)
  assert.notEqual(plantMood(perfect(s.ts), s, pothos).emotion, 'angry', 'water is felt at once')
  assert.ok(s.wellbeing < 60, 'four days of drought still show in the score')
  assert.equal(s.dryHours, 0, 'the drought clock resets on water')
})

test('wellbeing stays inside 0..100 under abuse', () => {
  const awful = (ts: number): SensorReading => ({ moisture: 0, soilTemp: 70, ec: 12, ph: 3, ts })
  const wrecked = run(initialState(awful(0), 50), awful, 24 * 60)
  assert.ok(wrecked.wellbeing >= 0 && wrecked.wellbeing <= 100)
  const spoiled = run(initialState(perfect(0), 50), perfect, 24 * 60)
  assert.ok(spoiled.wellbeing >= 0 && spoiled.wellbeing <= 100)
})

// ── the derived series (what the server hands the browser) ───────────────────

test('deriveSeries replays readings into a curve the client only renders', () => {
  const rows = Array.from({ length: 48 }, (_, i) => perfect(i * HOUR))
  const series = deriveSeries(rows, pothos, 40)
  assert.equal(series.length, 48)
  assert.ok(series[47].wellbeing > series[0].wellbeing, 'good care must trend up')
  assert.ok(series.every((p) => p.wellbeing >= 0 && p.wellbeing <= 100))
})

test('deriveSeries is deterministic — same readings, same curve', () => {
  const rows = Array.from({ length: 24 }, (_, i) => perfect(i * HOUR, { moisture: 20 + i }))
  assert.deepEqual(deriveSeries(rows, pothos), deriveSeries(rows, pothos))
})

test('deriveSeries survives an empty history', () => {
  assert.deepEqual(deriveSeries([], pothos), [])
})

// ── care events, inferred from the soil ─────────────────────────────────────

test('a moisture jump is read as someone watering — nobody had to say so', () => {
  const rows = [perfect(0, { moisture: 20 }), perfect(HOUR, { moisture: 55 })]
  const ev = detectEvents(rows)
  assert.equal(ev.length, 1)
  assert.equal(ev[0].kind, 'water')
  assert.equal(ev[0].ts, HOUR)
})

test('an EC jump is read as feeding', () => {
  const rows = [perfect(0, { ec: 0.8 }), perfect(HOUR, { ec: 1.5 })]
  assert.deepEqual(detectEvents(rows).map((e) => e.kind), ['feed'])
})

test('drying out is not a feed, even though EC rises as water leaves', () => {
  // Salt does not evaporate: EC climbs as the pot dries. That is physics, not
  // fertiliser, and calling it a "feed" would credit the owner for neglect.
  const rows = [perfect(0, { moisture: 60, ec: 1.0 }), perfect(HOUR, { moisture: 30, ec: 2.0 })]
  assert.deepEqual(detectEvents(rows), [])
})

test('evaporation alone raises no events', () => {
  const rows = Array.from({ length: 10 }, (_, i) => perfect(i * HOUR, { moisture: 60 - i }))
  assert.deepEqual(detectEvents(rows), [])
})

// ── the ingestion gate ──────────────────────────────────────────────────────

const NOW = 1_750_000_000_000
const goodBody = {
  device_token: 'dev_pothos_demo_01',
  ts: NOW,
  moisture: 45,
  soil_temp: 22.5,
  ec: 1.2,
  ph: 6.3,
}

test('ingest: a well-formed reading is accepted and mapped to camelCase', () => {
  const r = parseIngest(goodBody, NOW)
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.deviceToken, 'dev_pothos_demo_01')
  assert.equal(r.reading.soilTemp, 22.5)
  assert.equal(r.reading.moisture, 45)
})

test('ingest: round-trips through the wire shape unchanged', () => {
  const r = parseIngest(goodBody, NOW)
  assert.ok(r.ok)
  if (!r.ok) return
  assert.deepEqual(toWire(r.reading, r.deviceToken), goodBody)
})

test('ingest: refuses an unidentified device — a token is what makes data verified', () => {
  assert.equal(parseIngest({ ...goodBody, device_token: '' }, NOW).ok, false)
  assert.equal(parseIngest({ ...goodBody, device_token: 'short' }, NOW).ok, false)
})

test('ingest: refuses implausible values rather than clamping them', () => {
  for (const bad of [
    { moisture: 140 },
    { moisture: -1 },
    { ph: 15 },
    { ec: -0.5 },
    { soil_temp: 900 },
  ]) {
    const r = parseIngest({ ...goodBody, ...bad }, NOW)
    assert.equal(r.ok, false, `${JSON.stringify(bad)} must be refused, not coerced`)
  }
})

test('ingest: refuses a node with a dead clock', () => {
  // An ESP32 that never got NTP posts 1970. Plotting that would corrupt history.
  assert.equal(parseIngest({ ...goodBody, ts: 0 }, NOW).ok, false)
  assert.equal(parseIngest({ ...goodBody, ts: NOW + 3_600_000 }, NOW).ok, false)
})

test('ingest: refuses junk bodies', () => {
  assert.equal(parseIngest(null, NOW).ok, false)
  assert.equal(parseIngest('nope', NOW).ok, false)
  assert.equal(parseIngest({}, NOW).ok, false)
  assert.equal(parseIngest({ ...goodBody, moisture: 'wet' }, NOW).ok, false)
})
