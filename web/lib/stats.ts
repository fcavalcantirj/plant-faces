// Time-in-band stats — Thales.xlsx's tally, computed instead of hand-kept.
//
// Felipe's grow spreadsheet counts "VPD Correto (OK)" vs "Fora do Ideal" per
// month, per stage, in hand-wired formulas. This is that ledger as one pure
// function over stored readings: for each axis and each window
// (day/week/month/lifetime), how many readings sat inside the band, how many
// sat outside, and what share that is — plus the current unbroken in-band run
// in hours. The plant's agent QUOTES these numbers ("90% of the month my VPD
// was perfect"); nothing here judges, forecasts or heals — the mood engine
// owns the verdict, this file only counts.
//
// Deterministic on (rows, profile, stage, now): no wall clock, no store, no
// randomness — the same inputs tally the same forever.
//
// The value imports carry explicit .ts extensions because lib code runs under
// node --experimental-strip-types in tests, whose resolver requires them.

import { axisValue, type SensorReading } from './plant-mood.ts'
import {
  withStage,
  type AxisKey,
  type AxisSpec,
  type Band,
  type SpeciesProfile,
} from './species.ts'

export type StatsWindow = 'day' | 'week' | 'month' | 'lifetime'

const HOUR_MS = 3_600_000

/**
 * Window spans, measured back from `now`. A reading exactly on the boundary
 * is IN its window: "the last 24 hours" includes its own first minute.
 * `lifetime` has no span — every stored reading counts.
 */
const WINDOW_MS: Record<Exclude<StatsWindow, 'lifetime'>, number> = {
  day: 24 * HOUR_MS,
  week: 7 * 24 * HOUR_MS,
  month: 30 * 24 * HOUR_MS,
}

export interface AxisTally {
  /**
   * ok/(ok+out) as a percentage, one decimal. 0 when the window holds no
   * readings — the counts disambiguate "never measured" from "always out".
   */
  pct_in_band: number
  ok_count: number
  out_count: number
}

export interface PlantStats {
  /** The stage whose bands did the judging; null = the species' base bands. */
  stage: string | null
  windows: Record<StatsWindow, Partial<Record<AxisKey, AxisTally>>>
  /**
   * Hours of the current unbroken in-band run per axis, ending at the LAST
   * stored reading — a silent probe's streak does not keep growing, and a
   * run of one reading is 0 hours: duration needs two points.
   */
  streak_hours: Partial<Record<AxisKey, number>>
}

/** One decimal is a quotable stat; more is false precision from a soil probe. */
const round1 = (v: number) => Math.round(v * 10) / 10

/**
 * Band edges count as IN: axisComfort scores an edge 0 — a bad day, not
 * misery — and the spreadsheet's own OK column includes its thresholds.
 */
const inBand = (v: number, band: Band) => v >= band.min && v <= band.max

function tally(rows: SensorReading[], axis: AxisSpec): AxisTally {
  let ok = 0
  let out = 0
  for (const r of rows) {
    const v = axisValue(r, axis.key)
    if (v === undefined) continue // unmeasured on this reading: no vote either way
    if (inBand(v, axis.band)) ok++
    else out++
  }
  const n = ok + out
  return { pct_in_band: n === 0 ? 0 : round1((ok / n) * 100), ok_count: ok, out_count: out }
}

function streakHours(rows: SensorReading[], axis: AxisSpec): number {
  // Walk back from the newest reading while the axis stays in band. An
  // unmeasured value ends the walk: continuity through a gap nobody measured
  // is not something to attest.
  let start = -1
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = axisValue(rows[i], axis.key)
    if (v === undefined || !inBand(v, axis.band)) break
    start = i
  }
  if (start < 0) return 0
  return round1((rows[rows.length - 1].ts - rows[start].ts) / HOUR_MS)
}

/**
 * The whole ledger. `rows` are the stored readings, ascending by ts (the
 * store returns them sorted); `stage` picks the bands via withStage, so an
 * unknown stage refuses there rather than tallying against the wrong ruler.
 * Every axis the species lists is reported — trend-only pH included, because
 * a tally is observation, not verdict: pH never moves the mood, but "how
 * often it sat in band" is still an honest count.
 */
export function computeStats(
  rows: SensorReading[],
  profile: SpeciesProfile,
  stage: string | null,
  now: number,
): PlantStats {
  const judged = withStage(profile, stage)

  const windows = {} as Record<StatsWindow, Partial<Record<AxisKey, AxisTally>>>
  for (const w of ['day', 'week', 'month', 'lifetime'] as const) {
    const slice = w === 'lifetime' ? rows : rows.filter((r) => now - r.ts <= WINDOW_MS[w])
    const perAxis: Partial<Record<AxisKey, AxisTally>> = {}
    for (const a of judged.axes) perAxis[a.key] = tally(slice, a)
    windows[w] = perAxis
  }

  const streak_hours: Partial<Record<AxisKey, number>> = {}
  for (const a of judged.axes) streak_hours[a.key] = streakHours(rows, a)

  return { stage, windows, streak_hours }
}
