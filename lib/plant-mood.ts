// Plant mood engine.
//
// Turns a stream of soil readings into one `Emotion` for the EIDOLON face.
// Three ideas carry the whole thing:
//
//  1. COMFORT is instantaneous — how far each axis sits from the plant's ideal,
//     scored -1 (miserable) .. +1 (perfect).
//  2. LIEBIG'S LAW OF THE MINIMUM — a plant is limited by its scarcest resource,
//     not its average one. Any axis past its band edge caps the whole score, so
//     three happy axes can never outvote a fatal one.
//  3. WELLBEING is slow — a 0..100 accumulator chasing comfort with a time
//     constant in days. This is what makes care drift the face happier and
//     neglect drift it angrier, instead of flipping on every reading.
//
// Wellbeing heals slower than it harms (TAU_UP > TAU_DOWN): a week of care is
// undone by two bad days. True of plants, and the reason a leaderboard built on
// this scores stewardship rather than luck.
//
// No LLM is anywhere near this file. Every number the face implies is computed
// here and reproducible from the raw readings.

import type { Emotion } from './face-points'
import type { AxisKey, AxisSpec, Band, SpeciesProfile } from './species'

/** One sample from the probe. Mirrors the ingestion wire shape (see api.ts). */
export interface SensorReading {
  moisture: number // %
  soilTemp: number // °C
  ec: number // mS/cm
  ph: number
  ts: number // epoch ms
}

export interface PlantState {
  /** 0..100, slow-moving. The Tamagotchi number. */
  wellbeing: number
  /** Consecutive hours below the moisture floor. */
  dryHours: number
  /** epoch ms of the reading this state was last advanced to. */
  ts: number
}

export interface MoodResult {
  emotion: Emotion
  wellbeing: number
  /** -1..1 instantaneous, trust-damped, Liebig-capped comfort. */
  comfort: number
  /** Short line in the plant's own voice. */
  headline: string
  /** Why the engine chose this emotion. */
  reason: string
  /** Trend-only annotations (pH). Never part of the verdict. */
  notes: string[]
}

/** Hours for wellbeing to close ~63% of the gap up (healing) and down (harm). */
const TAU_UP_HOURS = 72
const TAU_DOWN_HOURS = 24

/** A reading older than this means the node is gone: show `glitch`, never a lie. */
export const STALE_MS = 90 * 60 * 1000

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function axisValue(reading: SensorReading, key: AxisKey): number | undefined {
  switch (key) {
    case 'moisture':
      return reading.moisture
    case 'soilTemp':
      return reading.soilTemp
    case 'ec':
      return reading.ec
    case 'ph':
      return reading.ph
    default:
      return undefined // light / airHumidity: the probe cannot measure them
  }
}

/**
 * Score one value against its band.
 * +1 at ideal, 0 at the min/max edges, falling to -1 once it is as far past an
 * edge as that edge is from ideal.
 */
export function axisComfort(value: number, band: Band): number {
  if (value === band.ideal) return 1
  const span = value < band.ideal ? band.ideal - band.min : band.max - band.ideal
  if (span <= 0) return -1 // degenerate band: anything off-ideal is misery
  const distance = Math.abs(value - band.ideal) / span // 0 at ideal, 1 at the edge
  return clamp(1 - distance, -1, 1)
}

/** The axes that are allowed to decide a verdict: measured, and not trend-only. */
export function verdictAxes(profile: SpeciesProfile, reading: SensorReading): AxisSpec[] {
  return profile.axes.filter(
    (a) => !a.trendOnly && a.trust > 0 && axisValue(reading, a.key) !== undefined,
  )
}

/**
 * Weighted comfort across the profile's axes, Liebig-capped and trust-damped.
 *
 * The cap is what stops perfect moisture from burying a salt-poisoned EC. The
 * trust damping is what stops a shaky EC from declaring a verdict alone: an
 * axis can only drag the score down in proportion to how much we believe it.
 */
export function comfortOf(reading: SensorReading, profile: SpeciesProfile): number {
  const axes = verdictAxes(profile, reading)
  if (axes.length === 0) return 0

  let weighted = 0
  let totalWeight = 0
  let worst = 1

  for (const a of axes) {
    const c = axisComfort(axisValue(reading, a.key)!, a.band)
    weighted += c * a.weight
    totalWeight += a.weight
    // Below the band edge, an axis pulls only as hard as it is trusted.
    const effective = c < 0 ? c * a.trust : c
    if (effective < worst) worst = effective
  }
  if (totalWeight > 0) weighted /= totalWeight

  return worst < 0 ? Math.min(weighted, worst) : weighted
}

export function initialState(reading: SensorReading, wellbeing = 70): PlantState {
  return { wellbeing, dryHours: 0, ts: reading.ts }
}

/**
 * Advance the accumulator to a new reading. Pure: returns a fresh state.
 * `dtHours` comes from the readings' own timestamps, so a simulated clock and a
 * real probe posting every 15 min run through identical code.
 */
export function stepState(
  state: PlantState,
  reading: SensorReading,
  profile: SpeciesProfile,
): PlantState {
  const dtHours = Math.max(0, (reading.ts - state.ts) / 3_600_000)
  const moisture = profile.axes.find((a) => a.key === 'moisture')!.band

  const dryHours = reading.moisture < moisture.min ? state.dryHours + dtHours : 0

  const comfort = comfortOf(reading, profile)
  const target = 50 + comfort * 50 // -1..1  ->  0..100
  const tau = target > state.wellbeing ? TAU_UP_HOURS : TAU_DOWN_HOURS
  const alpha = 1 - Math.exp(-dtHours / tau)
  const wellbeing = clamp(state.wellbeing + (target - state.wellbeing) * alpha, 0, 100)

  return { wellbeing, dryHours, ts: reading.ts }
}

/** pH is observed and reported, never allowed to judge. INVENTORY: "pH = trend only". */
function trendNotes(reading: SensorReading, profile: SpeciesProfile): string[] {
  const notes: string[] = []
  for (const a of profile.axes) {
    if (!a.trendOnly) continue
    const v = axisValue(reading, a.key)
    if (v === undefined) continue
    if (v < a.band.min || v > a.band.max) {
      notes.push(
        `${a.label} ${v.toFixed(1)} is outside ${a.band.min}–${a.band.max} — trend only, uncalibrated, not part of the verdict.`,
      )
    }
  }
  return notes
}

/**
 * Pick the face. First match wins, so an acute emergency always outranks the
 * slow mood — a thriving plant that is suddenly drowning looks queasy now, not
 * happy-with-an-asterisk.
 */
export function plantMood(
  reading: SensorReading | null,
  state: PlantState,
  profile: SpeciesProfile,
  now: number = reading?.ts ?? state.ts,
): MoodResult {
  const base = { wellbeing: state.wellbeing, comfort: 0, notes: [] as string[] }

  if (!reading || now - reading.ts > STALE_MS) {
    return {
      ...base,
      emotion: 'glitch',
      headline: 'Am I still here?',
      reason: 'No fresh reading — the probe is unplugged or the node is offline.',
    }
  }

  const comfort = comfortOf(reading, profile)
  const notes = trendNotes(reading, profile)
  const out = { ...base, comfort, notes }

  const moisture = profile.axes.find((a) => a.key === 'moisture')!
  const soilTemp = profile.axes.find((a) => a.key === 'soilTemp')
  const ec = profile.axes.find((a) => a.key === 'ec')

  if (reading.moisture > moisture.band.max) {
    return {
      ...out,
      emotion: 'confused',
      headline: 'I am swimming.',
      reason: `Moisture ${reading.moisture.toFixed(0)}% is above ${profile.label}'s ${moisture.band.max}% ceiling — roots drown before they thirst.`,
    }
  }

  if (reading.moisture < moisture.band.min && state.dryHours > profile.droughtPatienceHours) {
    return {
      ...out,
      emotion: 'angry',
      headline: 'You forgot me.',
      reason: `Dry for ${state.dryHours.toFixed(0)}h — past ${profile.label}'s ${profile.droughtPatienceHours}h patience.`,
    }
  }

  if (ec && reading.ec > ec.band.max) {
    return {
      ...out,
      emotion: 'alert',
      headline: 'The soil burns.',
      reason: `EC ${reading.ec.toFixed(2)} mS/cm is over ${ec.band.max} — salt building up. You are feeding me too much${ec.uncalibrated ? ' (EC bands uncalibrated)' : ''}.`,
    }
  }

  if (soilTemp && reading.soilTemp > soilTemp.band.max) {
    return {
      ...out,
      emotion: 'alert',
      headline: 'My roots are cooking.',
      reason: `Soil ${reading.soilTemp.toFixed(1)}°C is over the ${soilTemp.band.max}°C ceiling.`,
    }
  }

  if (reading.moisture < moisture.band.min) {
    return {
      ...out,
      emotion: 'sad',
      headline: 'I could use a drink.',
      reason: `Moisture ${reading.moisture.toFixed(0)}% is under ${moisture.band.min}% — thirsty for ${state.dryHours.toFixed(0)}h so far.`,
    }
  }

  if (ec && reading.ec < ec.band.min) {
    return {
      ...out,
      emotion: 'sad',
      headline: 'There is nothing left to eat.',
      reason: `EC ${reading.ec.toFixed(2)} mS/cm is under ${ec.band.min} — the soil is spent. Water carries food away; feed me${ec.uncalibrated ? ' (EC bands uncalibrated)' : ''}.`,
    }
  }

  if (soilTemp && reading.soilTemp < soilTemp.band.min) {
    return {
      ...out,
      emotion: 'sleepy',
      headline: 'Too cold to grow.',
      reason: `Soil ${reading.soilTemp.toFixed(1)}°C is under the ${soilTemp.band.min}°C floor — dormant, not dying.`,
    }
  }

  if (state.wellbeing >= 80) {
    return {
      ...out,
      emotion: 'love',
      headline: 'I have never felt better.',
      reason: `Every axis in range and wellbeing ${state.wellbeing.toFixed(0)}/100 — this is what good care looks like.`,
    }
  }
  if (state.wellbeing >= 55) {
    return {
      ...out,
      emotion: 'happy',
      headline: 'This is nice.',
      reason: `All readings in range, wellbeing ${state.wellbeing.toFixed(0)}/100 and climbing.`,
    }
  }
  if (state.wellbeing >= 30) {
    return {
      ...out,
      emotion: 'neutral',
      headline: 'Getting there.',
      reason: `Conditions are good now; wellbeing ${state.wellbeing.toFixed(0)}/100 is still recovering.`,
    }
  }
  return {
    ...out,
    emotion: 'sad',
    headline: 'Still hurting.',
    reason: `Conditions are fine now, but wellbeing is only ${state.wellbeing.toFixed(0)}/100. Recovery takes days.`,
  }
}

/**
 * Replay a whole reading series into a wellbeing curve. This is what the server
 * runs to derive history — the client renders it, never computes it.
 */
export interface SeriesPoint {
  ts: number
  wellbeing: number
  emotion: Emotion
  moisture: number
  ec: number
}

/**
 * Care events, INFERRED from the soil rather than reported by the app.
 *
 * Nobody tells us they watered — a button that logged "I watered it" would be
 * exactly the self-reported claim this product refuses. Instead: moisture jumped
 * = someone poured water in; EC jumped = someone fed it. The pot is the witness.
 */
export type CareEventKind = 'water' | 'feed'
export interface CareEvent {
  ts: number
  kind: CareEventKind
}

/** A jump this big between consecutive readings did not happen by evaporation. */
const WATER_JUMP_PCT = 8
const FEED_JUMP_EC = 0.25

export function detectEvents(readings: SensorReading[]): CareEvent[] {
  const out: CareEvent[] = []
  for (let i = 1; i < readings.length; i++) {
    const prev = readings[i - 1]
    const cur = readings[i]
    if (cur.moisture - prev.moisture >= WATER_JUMP_PCT) out.push({ ts: cur.ts, kind: 'water' })
    // Watering DILUTES salt, so a real feed is an EC rise that is not just a
    // concentration artefact of the pot drying out.
    if (cur.ec - prev.ec >= FEED_JUMP_EC && cur.moisture >= prev.moisture - 1) {
      out.push({ ts: cur.ts, kind: 'feed' })
    }
  }
  return out
}

export function deriveSeries(
  readings: SensorReading[],
  profile: SpeciesProfile,
  startWellbeing = 62,
): SeriesPoint[] {
  if (readings.length === 0) return []
  let state = initialState(readings[0], startWellbeing)
  const out: SeriesPoint[] = []
  for (const r of readings) {
    state = stepState(state, r, profile)
    const mood = plantMood(r, state, profile)
    out.push({
      ts: r.ts,
      wellbeing: state.wellbeing,
      emotion: mood.emotion,
      moisture: r.moisture,
      ec: r.ec,
    })
  }
  return out
}
