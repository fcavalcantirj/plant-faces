// Channel registry — the vocabulary of the modular ingestion door.
//
// A SOURCE posts named channels through envelope v1 (see ingest.ts); this
// registry is the complete list of names the door accepts. Each entry pins the
// unit, the plausibility rails, the graded trust the measurement deserves, and
// which verdict axis (if any) the channel feeds. Adding a sensor capability —
// light_lux, co2_ppm, biopot_mv — is one row here: the envelope parser and the
// mood engine pick it up with no rewrite.
//
// Unknown channels are REFUSED, not dropped: a silently discarded measurement
// is a lie about what the source reported. Out-of-range values bounce with the
// channel's name in the error — the same refuse-don't-clamp rule as the legacy
// parser, applied per channel.
//
// The value import carries an explicit .ts extension because lib code runs
// under node --experimental-strip-types in tests, whose resolver requires it.

import { TRUST, type AxisKey } from './species.ts'

export interface ChannelSpec {
  unit: string
  /** Plausibility rails. A sensor reporting outside these is broken, not honest. */
  min: number
  max: number
  /** Graded trust, 0..1 — mirrors the verdict-axis damping in species.ts. */
  trust: number
  /** Verdict axis this channel feeds, or null: measured and archived, never judged. */
  axis: AxisKey | null
}

export const CHANNELS = {
  soil_moisture_pct: { unit: '%', min: 0, max: 100, trust: TRUST.moisture, axis: 'moisture' },
  soil_temp_c: { unit: '°C', min: -20, max: 80, trust: TRUST.soilTemp, axis: 'soilTemp' },
  soil_ec_ms_cm: { unit: 'mS/cm', min: 0, max: 20, trust: TRUST.ec, axis: 'ec' },
  soil_ph: { unit: 'pH', min: 0, max: 14, trust: TRUST.ph, axis: 'ph' },
  // Air channels feed no verdict axis yet: they are archive material (VPD,
  // later), not judgement. Trust matches soilTemp — thermistor-class sensors.
  air_temp_c: { unit: '°C', min: -10, max: 60, trust: 0.85, axis: null },
  rh_pct: { unit: '%', min: 0, max: 100, trust: 0.85, axis: null },
} as const satisfies Record<string, ChannelSpec>

export type ChannelName = keyof typeof CHANNELS

/** A validated set of channel values — every key known, every value in range. */
export type ChannelValues = Partial<Record<ChannelName, number>>

export type ChannelsResult =
  | { ok: true; channels: ChannelValues }
  | { ok: false; error: string }

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Validate a channels map against the registry. Refuses rather than coercing,
 * and the error names the offending channel so the source can fix itself.
 * `Object.hasOwn` guards the lookup: a channel named "toString" must be judged
 * unknown, not matched against Object.prototype.
 */
export function validateChannels(channels: Record<string, unknown>): ChannelsResult {
  const out: ChannelValues = {}
  for (const [name, v] of Object.entries(channels)) {
    const spec = Object.hasOwn(CHANNELS, name)
      ? (CHANNELS as Record<string, ChannelSpec>)[name]
      : undefined
    if (!spec) return { ok: false, error: `unknown channel "${name}" — not in the registry` }
    if (!num(v)) return { ok: false, error: `channel ${name} must be a finite number` }
    if (v < spec.min || v > spec.max) {
      return {
        ok: false,
        error: `channel ${name}=${v} out of plausible range ${spec.min}..${spec.max}`,
      }
    }
    out[name as ChannelName] = v
  }
  return { ok: true, channels: out }
}
