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
//
// Growth STAGES are the same additive idea in time instead of hardware: a
// species may declare named stages (cannabis: vega/flora — Thales.xlsx proves
// the grow already alarms on different bands per stage) that override ONLY the
// bands they name. No stage declared, or none selected, means the base bands,
// so every stageless profile below is byte-identical to before.

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
  /**
   * Named growth stages, each overriding ONLY the bands it lists — weights,
   * trust and the axis set never change with age. Stageless species omit
   * this; which stage a real plant is in lives in the plant registry
   * (store.ts), set by its keeper, and travels here through withStage.
   */
  stages?: Record<string, Partial<Record<AxisKey, Band>>>
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
  {
    id: 'cannabis',
    label: 'CANNABIS',
    emoji: '🍁',
    blurb: 'Stage-aware. Vega drinks deep; flora wants restraint.',
    // Literature guesses for soil in pots — calibrated against NO probe, NO
    // soil and NO grow, so every axis is flagged, not just the usual EC/pH.
    axes: soilAxes({
      moisture: { min: 35, ideal: 55, max: 75 },
      soilTemp: { min: 15, ideal: 22, max: 30 },
      ec: { min: 0.8, ideal: 1.5, max: 2.2 },
      ph: { min: 6.0, ideal: 6.5, max: 7.0 },
    }).map((a) => ({ ...a, uncalibrated: true })),
    stages: {
      // Vegetative growth drinks hard and feeds light…
      vega: {
        moisture: { min: 40, ideal: 60, max: 80 },
        ec: { min: 0.8, ideal: 1.3, max: 2.0 },
      },
      // …flowering dries back and feeds heavier.
      flora: {
        moisture: { min: 30, ideal: 50, max: 70 },
        ec: { min: 1.0, ideal: 1.8, max: 2.6 },
      },
    },
    // TODO(felipe-decision-3): Vega/Flora AIR bands (air_temp_c + rh_pct, the
    // VPD pair) are deliberately ABSENT. Felipe's spreadsheet (Thales.xlsx,
    // the "Alarme Vega"/"Alarme Flora" label boundaries) is the source of
    // truth for those thresholds; T0.7b derives them from the sheet and
    // Felipe confirms — they are not invented here. Until then cannabis
    // judges soil only, exactly like every other profile.
    dryRatePerHour: 1.2,
    droughtPatienceHours: 36,
  },
  {
    id: 'pepper',
    label: 'PEPPER',
    emoji: '🌶️',
    blurb: 'The first real plant on the wire. Warm feet, steady meals.',
    // Felipe's home pepper in a vase — the first plant a probe actually lives
    // in. Bands are literature guesses for potted Capsicum, pending
    // calibration against the real THCPH-S in this pot; until that data
    // lands, EC and pH keep the usual uncalibrated flags from soilAxes.
    axes: soilAxes({
      moisture: { min: 30, ideal: 50, max: 75 },
      soilTemp: { min: 15, ideal: 24, max: 33 },
      ec: { min: 0.8, ideal: 1.4, max: 2.4 },
      ph: { min: 5.8, ideal: 6.3, max: 7.0 },
    }),
    dryRatePerHour: 1.0,
    droughtPatienceHours: 24,
  },
]

export const DEFAULT_SPECIES = SPECIES[0]

export function speciesById(id: string): SpeciesProfile {
  return SPECIES.find((s) => s.id === id) ?? DEFAULT_SPECIES
}

/**
 * Resolve a profile to a growth stage: overridden bands in, everything else
 * (weights, trust, display, the axis set) untouched. `null`/`undefined` means
 * stageless and returns the profile AS-IS — the same object, so every
 * stageless caller behaves byte-identically to before. A stage the species
 * never declared is REFUSED, not defaulted: judging flora by base bands
 * because of a typo in the registry would be a quiet lie about the plant.
 */
export function withStage(
  profile: SpeciesProfile,
  stage: string | null | undefined,
): SpeciesProfile {
  if (stage === null || stage === undefined) return profile
  // Object.hasOwn, as in channels.ts: a stage named "toString" is unknown.
  const overrides =
    profile.stages && Object.hasOwn(profile.stages, stage) ? profile.stages[stage] : undefined
  if (!overrides) {
    throw new Error(`species ${profile.id} has no stage "${stage}" — refusing to guess bands`)
  }
  return {
    ...profile,
    axes: profile.axes.map((a) => {
      const band = overrides[a.key]
      return band === undefined ? a : { ...a, band }
    }),
  }
}

export function axisOf(
  profile: SpeciesProfile,
  key: AxisKey,
  stage?: string | null,
): AxisSpec | undefined {
  return withStage(profile, stage ?? null).axes.find((a) => a.key === key)
}
