// The virtual device.
//
// Stands in for the ESP32 + THCPH-S until the probe lands, and is deleted the
// day it does. It models the pot, not the app: soil dries, salts concentrate as
// water leaves, watering dilutes, feeding adds salt. Then it POSTs the SAME
// wire shape the real node will.
//
// Nothing in here is a product feature. Watering is something a HUMAN does to a
// POT; this module only simulates the physical world the probe reads.

import type { SensorReading } from './plant-mood'
import type { SpeciesProfile } from './species'

export type Climate = 'cold' | 'mild' | 'hot'

/** Daily mean soil temperature (°C). Soil lags air and swings less. */
export const CLIMATE_BASE: Record<Climate, number> = { cold: 13, mild: 22, hot: 31 }

export interface Pot {
  /** Simulated epoch ms. */
  ts: number
  moisture: number
  /** Salts in the pot, expressed directly as EC (mS/cm). */
  ec: number
  ph: number
}

const HOUR = 3_600_000
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function hourOfDay(ts: number): number {
  return (ts % 86_400_000) / HOUR
}

/** Soil temperature: daily mean plus a small, lagged swing. */
export function soilTempAt(ts: number, climate: Climate): number {
  return CLIMATE_BASE[climate] + Math.sin(((hourOfDay(ts) - 11) / 24) * Math.PI * 2) * 2.5
}

/**
 * How far back a fresh pot starts.
 *
 * The sim fast-forwards (plant-hours per real second), but /api/ingest refuses
 * timestamps from the future — a rail that exists so a real node with a broken
 * clock cannot corrupt history, and which the simulator must respect like
 * anything else that posts. So the pot starts two weeks in the PAST and catches
 * up to now: every timestamp it emits is real, ordinary, plausible epoch ms.
 */
export const SIM_BACKDATE_MS = 14 * 24 * HOUR

export function newPot(profile: SpeciesProfile, ts = Date.now() - SIM_BACKDATE_MS): Pot {
  const moisture = profile.axes.find((a) => a.key === 'moisture')!.band.ideal
  const ec = profile.axes.find((a) => a.key === 'ec')!.band.ideal
  const ph = profile.axes.find((a) => a.key === 'ph')!.band.ideal
  return { ts, moisture, ec, ph }
}

/**
 * Advance the pot by `dtHours`.
 *
 * The EC coupling is the interesting bit and it is real horticulture: salts do
 * not evaporate. As water leaves, the same salt sits in less water, so EC RISES
 * as the pot dries — which is why a neglected plant eventually reads salty as
 * well as thirsty, and why flushing with plain water is how you fix it.
 */
export function stepPot(
  pot: Pot,
  profile: SpeciesProfile,
  climate: Climate,
  dtHours: number,
): Pot {
  const ts = pot.ts + dtHours * HOUR
  const heat = 1 + Math.max(0, soilTempAt(ts, climate) - 20) * 0.05
  const lost = profile.dryRatePerHour * heat * dtHours
  const moisture = clamp(pot.moisture - lost, 0, 100)

  // Conserve salt: ec × water ≈ constant, so EC rises as the pot dries.
  //
  // ⚠ Crude, and only honest in the middle of the range. The floor matters: with
  // a floor of 1 the ratio explodes as moisture → 0 and a dry pot reported 20
  // mS/cm, which is not a houseplant, it is seawater. Real soil is worse than
  // crude here — a probe needs water to conduct at all, so BULK EC actually
  // reads LOW in bone-dry soil even while the pore water is saltier than ever.
  // Modelling that properly is a job for the day the real probe lands and can
  // be measured against; until then the floor keeps the number plausible.
  const WATER_FLOOR = 10
  const before = Math.max(pot.moisture, WATER_FLOOR)
  const after = Math.max(moisture, WATER_FLOOR)
  const ec = clamp(pot.ec * (before / after), 0, 6)

  // pH drifts slowly with salt load. Trend only — never judged.
  const ph = clamp(pot.ph + (ec > 2 ? -0.002 : 0.001) * dtHours, 3.5, 9)

  return { ts, moisture, ec, ph }
}

/** A human walks over with a watering can. Plain water dilutes the salts. */
export function water(pot: Pot, profile: SpeciesProfile): Pot {
  const band = profile.axes.find((a) => a.key === 'moisture')!.band
  const target = clamp(band.ideal + 12, 0, band.max - 2)
  // Same floor as stepPot, and for the same reason: without it a bone-dry pot
  // dilutes by 1/57 and reads as flushed clean, which no watering can achieve.
  const dilution = Math.max(pot.moisture, 10) / Math.max(target, 10)
  return { ...pot, moisture: target, ec: clamp(pot.ec * dilution, 0.05, 6) }
}

/** Too much water: waterlogged AND flushed nearly salt-free. */
export function flood(pot: Pot, profile: SpeciesProfile): Pot {
  const band = profile.axes.find((a) => a.key === 'moisture')!.band
  return { ...pot, moisture: clamp(band.max + 15, 0, 100), ec: clamp(pot.ec * 0.35, 0.05, 20) }
}

/** A human feeds it. Fertiliser is salt: EC jumps. */
export function feed(pot: Pot, profile: SpeciesProfile): Pot {
  const band = profile.axes.find((a) => a.key === 'ec')!.band
  // One dose nudges EC toward ideal. The old version added ideal-min+0.35, which
  // shoved a healthy pot straight past its ceiling — so the scripted "good
  // owner" was salt-burning the plant it was supposed to be caring for.
  const dose = (band.ideal - band.min) * 0.6
  return { ...pot, ec: clamp(pot.ec + dose, 0, 6) }
}

/** What the probe would report right now. */
export function probeReading(pot: Pot, climate: Climate): SensorReading {
  return {
    moisture: pot.moisture,
    soilTemp: soilTempAt(pot.ts, climate),
    ec: pot.ec,
    ph: pot.ph,
    ts: pot.ts,
  }
}

export const PLANT_CLIMATES: Climate[] = ['cold', 'mild', 'hot']

/**
 * A scripted fortnight, for the time-lapse. Returns readings only — it POSTs
 * through the same door as everything else. `care`: watered before it ever gets
 * thirsty, fed weekly. `neglect`: nobody comes.
 */
export function fortnight(
  profile: SpeciesProfile,
  climate: Climate,
  kind: 'care' | 'neglect',
  endTs: number,
  stepHours = 2,
): SensorReading[] {
  const total = 14 * 24
  let pot = newPot(profile, endTs - total * HOUR)
  const out: SensorReading[] = []
  const moisture = profile.axes.find((a) => a.key === 'moisture')!.band
  const ec = profile.axes.find((a) => a.key === 'ec')!.band

  for (let h = 0; h < total; h += stepHours) {
    pot = stepPot(pot, profile, climate, stepHours)
    if (kind === 'care') {
      // A good owner waters before the floor, and feeds only when the soil is
      // actually spent — feeding on a schedule regardless of EC is how you
      // salt-burn a plant while believing you are looking after it.
      if (pot.moisture < moisture.min + 6) pot = water(pot, profile)
      if (h > 0 && h % (24 * 7) === 0 && pot.ec < ec.ideal) pot = feed(pot, profile)
    }
    out.push(probeReading(pot, climate))
  }
  return out
}
