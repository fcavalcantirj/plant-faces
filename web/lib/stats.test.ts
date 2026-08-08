// Run: pnpm test
//
// The time-in-band tally and the stage bands that judge it. What is pinned:
// exactly 90% in band reads 90.0, not 89.9-something; the SAME reading is OK
// under vega and fora under flora, so the registry's stage genuinely changes
// the judge; windows slice on the reading's age with the boundary included;
// an empty history tallies zeros, never NaN; an unknown stage refuses instead
// of borrowing the base bands; and a stage overrides only the bands it names.

import test from 'node:test'
import assert from 'node:assert/strict'
import type { SensorReading } from './plant-mood.ts'
import { axisOf, speciesById, withStage } from './species.ts'
import { computeStats, type StatsWindow } from './stats.ts'

const NOW = 1_754_650_000_000
const HOUR = 3_600_000
const DAY = 24 * HOUR
const pothos = speciesById('pothos')
const cannabis = speciesById('cannabis')

/** A pothos-perfect reading; override one axis to push it out of band. */
const reading = (ts: number, over: Partial<SensorReading> = {}): SensorReading => ({
  moisture: 45,
  soilTemp: 23,
  ec: 1.2,
  ph: 6.3,
  ts,
  ...over,
})

// ── the tally ───────────────────────────────────────────────────────────────

test('exactly 90% of readings in band reads pct_in_band === 90.0', () => {
  // 20 hourly readings, the first 2 bone-dry: 18/20 in band on moisture.
  const rows = Array.from({ length: 20 }, (_, i) =>
    reading(NOW - (19 - i) * HOUR, i < 2 ? { moisture: 10 } : {}),
  )
  const s = computeStats(rows, pothos, null, NOW)
  const m = s.windows.lifetime.moisture!
  assert.equal(m.pct_in_band, 90.0)
  assert.equal(m.ok_count, 18)
  assert.equal(m.out_count, 2)
  // The axes that never left their bands read a clean 100.
  assert.deepEqual(s.windows.lifetime.soilTemp, { pct_in_band: 100, ok_count: 20, out_count: 0 })
})

test('the tally is deterministic — same inputs, same ledger', () => {
  const rows = Array.from({ length: 10 }, (_, i) =>
    reading(NOW - (9 - i) * HOUR, i % 3 === 0 ? { ec: 2.5 } : {}),
  )
  assert.deepEqual(computeStats(rows, pothos, null, NOW), computeStats(rows, pothos, null, NOW))
})

test('band edges count as IN — the spreadsheet OK column includes its thresholds', () => {
  const rows = [reading(NOW, { moisture: 25 }), reading(NOW - HOUR, { moisture: 70 })]
  const m = computeStats(rows, pothos, null, NOW).windows.lifetime.moisture!
  assert.equal(m.ok_count, 2)
  assert.equal(m.out_count, 0)
})

// ── stage bands ─────────────────────────────────────────────────────────────

test('stage switch changes the judge: one reading, OK in vega, fora in flora', () => {
  // 75% moisture: inside vega's 40..80, outside flora's 30..70.
  const rows = [reading(NOW, { moisture: 75, soilTemp: 22, ec: 1.5, ph: 6.5 })]
  const vega = computeStats(rows, cannabis, 'vega', NOW)
  const flora = computeStats(rows, cannabis, 'flora', NOW)
  assert.deepEqual(vega.windows.lifetime.moisture, { pct_in_band: 100, ok_count: 1, out_count: 0 })
  assert.deepEqual(flora.windows.lifetime.moisture, { pct_in_band: 0, ok_count: 0, out_count: 1 })
  assert.equal(vega.stage, 'vega')
  assert.equal(flora.stage, 'flora')
  // And the mirror image on EC: 2.4 suits flowering, overfeeds a seedling.
  const ec = [reading(NOW, { moisture: 55, soilTemp: 22, ec: 2.4, ph: 6.5 })]
  assert.equal(computeStats(ec, cannabis, 'flora', NOW).windows.lifetime.ec!.ok_count, 1)
  assert.equal(computeStats(ec, cannabis, 'vega', NOW).windows.lifetime.ec!.out_count, 1)
})

test('a stage overrides only the bands it names', () => {
  const vega = withStage(cannabis, 'vega')
  assert.notDeepEqual(axisOf(vega, 'moisture')!.band, axisOf(cannabis, 'moisture')!.band)
  // soilTemp is not listed by any cannabis stage: the base band judges it.
  assert.deepEqual(axisOf(vega, 'soilTemp'), axisOf(cannabis, 'soilTemp'))
  // axisOf threads the stage itself, too.
  assert.deepEqual(axisOf(cannabis, 'ec', 'flora')!.band, { min: 1.0, ideal: 1.8, max: 2.6 })
  // Stageless resolution returns the very same object — base bands, no copy.
  assert.equal(withStage(pothos, null), pothos)
  assert.equal(withStage(cannabis, undefined), cannabis)
})

test('an unknown stage refuses — no silent fallback to the base bands', () => {
  assert.throws(() => computeStats([reading(NOW)], cannabis, 'seedling', NOW), /no stage "seedling"/)
  assert.throws(() => withStage(pothos, 'vega'), /no stage "vega"/)
  assert.throws(() => axisOf(cannabis, 'moisture', 'toString'), /no stage "toString"/)
})

test('cannabis: every soil band is a literature guess and flagged as such', () => {
  for (const a of cannabis.axes) {
    assert.equal(a.uncalibrated, true, `${a.key} must carry the uncalibrated flag`)
  }
})

// ── windows ─────────────────────────────────────────────────────────────────

test('windows slice on reading age; a boundary reading is IN its window', () => {
  const rows = [
    reading(NOW - 45 * DAY), // lifetime only
    reading(NOW - 10 * DAY), // month
    reading(NOW - 3 * DAY), // week
    reading(NOW - DAY), // exactly one day old — still the day window
    reading(NOW - HOUR), // day
  ]
  const s = computeStats(rows, pothos, null, NOW)
  const okIn = (w: StatsWindow) => s.windows[w].moisture!.ok_count
  assert.equal(okIn('day'), 2)
  assert.equal(okIn('week'), 3)
  assert.equal(okIn('month'), 4)
  assert.equal(okIn('lifetime'), 5)
})

test('empty history tallies zeros — never NaN', () => {
  const s = computeStats([], pothos, null, NOW)
  for (const w of ['day', 'week', 'month', 'lifetime'] as const) {
    for (const a of ['moisture', 'soilTemp', 'ec', 'ph'] as const) {
      assert.deepEqual(s.windows[w][a], { pct_in_band: 0, ok_count: 0, out_count: 0 })
    }
  }
  assert.deepEqual(s.streak_hours, { moisture: 0, soilTemp: 0, ec: 0, ph: 0 })
  assert.equal(s.stage, null)
})

// ── the streak ──────────────────────────────────────────────────────────────

test('streak: hours from the first reading of the current run to the last', () => {
  // Six hourly readings, out of band at i=1: the current run is the last four.
  const rows = [
    reading(NOW - 5 * HOUR),
    reading(NOW - 4 * HOUR, { moisture: 10 }),
    reading(NOW - 3 * HOUR),
    reading(NOW - 2 * HOUR),
    reading(NOW - HOUR),
    reading(NOW),
  ]
  const s = computeStats(rows, pothos, null, NOW)
  assert.equal(s.streak_hours.moisture, 3)
  // The axes that never broke span the whole series.
  assert.equal(s.streak_hours.soilTemp, 5)
})

test('streak: a latest reading out of band means no current streak', () => {
  const rows = [reading(NOW - HOUR), reading(NOW, { moisture: 10 })]
  assert.equal(computeStats(rows, pothos, null, NOW).streak_hours.moisture, 0)
})

test('streak: one in-band reading is zero hours — duration needs two points', () => {
  assert.equal(computeStats([reading(NOW)], pothos, null, NOW).streak_hours.moisture, 0)
})
