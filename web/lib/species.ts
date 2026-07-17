// Per-species care profiles.
//
// The axis SET is data-driven, not hardcoded: a profile lists the axes it is
// judged on. Today those are exactly what the gadget returns — a ComWinTop
// THCPH-S RS485 4-in-1 pushed into the soil like a pen drive: moisture, soil
// temperature, EC and pH. Nothing else is modelled, because nothing else is
// measured: the probe cannot see light and cannot smell the air.
//
// Adding an ambient sensor later is ADDITIVE — push a `light` axis onto a
// profile's list and the mood engine picks it up with no rewrite.

export type AxisKey = 'moisture' | 'soilTemp' | 'ec' | 'ph' | 'light' | 'airHumidity'

export interface Band {
  min: number
  ideal: number
  max: number
}

export interface AxisSpec {
  key: AxisKey
  label: string
  unit: string
  band: Band
  /** Share of the weighted comfort score. Weights across an axis set sum to 1. */
  weight: number
  /**
   * How far this axis is allowed to drag the verdict, 0..1 — GRADED TRUST by
   * measurement reliability: moisture > soilTemp > EC > pH. A shaky EC must not
   * declare a verdict on its own, so its Liebig cap is damped by this factor.
   */
  trust: number
  /** Never enters the mood verdict; annotates a trend only. */
  trendOnly?: boolean
  /** Band is a literature guess, not calibrated against this probe and soil. */
  uncalibrated?: boolean
  /** Gauge range for display. */
  display: { min: number; max: number }
}

export interface SpeciesProfile {
  id: string
  label: string
  emoji: string
  blurb: string
  axes: AxisSpec[]
  /** Moisture-% lost per hour at ideal soil temp. */
  dryRatePerHour: number
  /**
   * Hours below the moisture floor before thirst reads as neglect rather than a
   * bad day. A cactus shrugs off a dry fortnight; a fern is furious by dinner.
   */
  droughtPatienceHours: number
}

/** Trust constants, named so the ordering is a claim the tests can pin. */
export const TRUST = {
  /** Capacitive moisture is the reliable one and the anchor of the verdict. */
  moisture: 1.0,
  /** Soil temp is a thermistor — solid. */
  soilTemp: 0.85,
  /** EC drifts with temperature and probe fouling. Real, but damped. */
  ec: 0.6,
  /** pH needs calibration these probes do not hold. INVENTORY: "pH = trend only". */
  ph: 0,
} as const

function soilAxes(o: {
  moisture: Band
  soilTemp: Band
  ec: Band
  ph: Band
}): AxisSpec[] {
  return [
    {
      key: 'moisture',
      label: 'MOISTURE',
      unit: '%',
      band: o.moisture,
      weight: 0.5,
      trust: TRUST.moisture,
      display: { min: 0, max: 100 },
    },
    {
      key: 'soilTemp',
      label: 'SOIL TEMP',
      unit: '°C',
      band: o.soilTemp,
      weight: 0.2,
      trust: TRUST.soilTemp,
      display: { min: 0, max: 45 },
    },
    {
      key: 'ec',
      label: 'EC',
      unit: ' mS/cm',
      band: o.ec,
      weight: 0.3,
      trust: TRUST.ec,
      uncalibrated: true,
      display: { min: 0, max: 3 },
    },
    {
      key: 'ph',
      label: 'pH',
      unit: '',
      band: o.ph,
      weight: 0,
      trust: TRUST.ph,
      trendOnly: true,
      uncalibrated: true,
      display: { min: 4, max: 9 },
    },
  ]
}

export const SPECIES: SpeciesProfile[] = [
  {
    id: 'pothos',
    label: 'POTHOS',
    emoji: '🌿',
    blurb: 'Forgiving vine. The plant that survives you.',
    axes: soilAxes({
      moisture: { min: 25, ideal: 45, max: 70 },
      soilTemp: { min: 15, ideal: 23, max: 30 },
      ec: { min: 0.6, ideal: 1.2, max: 2.0 },
      ph: { min: 5.5, ideal: 6.3, max: 7.0 },
    }),
    dryRatePerHour: 0.7,
    droughtPatienceHours: 72,
  },
  {
    id: 'fern',
    label: 'FERN',
    emoji: '🌱',
    blurb: 'Drama queen. Wet feet, light feeding.',
    axes: soilAxes({
      moisture: { min: 45, ideal: 65, max: 85 },
      soilTemp: { min: 16, ideal: 21, max: 26 },
      ec: { min: 0.4, ideal: 0.9, max: 1.6 },
      ph: { min: 5.0, ideal: 5.8, max: 6.5 },
    }),
    dryRatePerHour: 1.4,
    droughtPatienceHours: 12,
  },
  {
    id: 'cactus',
    label: 'CACTUS',
    emoji: '🌵',
    blurb: 'Wants to be ignored. Overwatering is the only way to kill it.',
    axes: soilAxes({
      moisture: { min: 5, ideal: 18, max: 40 },
      soilTemp: { min: 10, ideal: 27, max: 38 },
      ec: { min: 0.3, ideal: 0.8, max: 1.5 },
      ph: { min: 6.0, ideal: 6.8, max: 7.5 },
    }),
    dryRatePerHour: 0.25,
    droughtPatienceHours: 240,
  },
  {
    id: 'basil',
    label: 'BASIL',
    emoji: '🪴',
    blurb: 'Thirsty and hungry. Wilts loudly, recovers fast.',
    axes: soilAxes({
      moisture: { min: 35, ideal: 55, max: 75 },
      soilTemp: { min: 18, ideal: 24, max: 32 },
      ec: { min: 0.8, ideal: 1.4, max: 2.2 },
      ph: { min: 5.5, ideal: 6.3, max: 7.0 },
    }),
    dryRatePerHour: 1.1,
    droughtPatienceHours: 18,
  },
]

export const DEFAULT_SPECIES = SPECIES[0]

export function speciesById(id: string): SpeciesProfile {
  return SPECIES.find((s) => s.id === id) ?? DEFAULT_SPECIES
}

export function axisOf(profile: SpeciesProfile, key: AxisKey): AxisSpec | undefined {
  return profile.axes.find((a) => a.key === key)
}
