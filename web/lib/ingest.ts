// The ingestion contract.
//
// ONE wire shape, posted by the simulator today and by the real node tomorrow —
// an ESP32 reading a ComWinTop THCPH-S over RS485 (ESPHome modbus_controller +
// MAX485). They are interchangeable by construction: if the sim can drive the
// app through this endpoint, so can the probe.
//
//   POST /api/ingest
//   { "device_token": "...", "ts": 1750000000000,
//     "moisture": 42.1, "soil_temp": 22.4, "ec": 1.15, "ph": 6.3 }
//
// snake_case on the wire (it is what an ESPHome lambda emits most naturally),
// camelCase inside. The token is what makes a reading VERIFIED rather than
// claimed — the anti-cheat leg of any future leaderboard. Verify at the source.

import type { SensorReading } from './plant-mood'

export interface IngestBody {
  device_token: string
  ts: number
  moisture: number
  soil_temp: number
  ec: number
  ph: number
}

export type ParseResult =
  | { ok: true; deviceToken: string; reading: SensorReading }
  | { ok: false; error: string }

/** Plausibility rails. A probe that reports -400 %RH is broken, not honest. */
const RANGES: Record<keyof Omit<IngestBody, 'device_token' | 'ts'>, [number, number]> = {
  moisture: [0, 100],
  soil_temp: [-20, 80],
  ec: [0, 20],
  ph: [0, 14],
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Validate an inbound reading. Rejects rather than coerces: a silently clamped
 * reading is a lie the whole app would then compute on.
 */
export function parseIngest(raw: unknown, now: number): ParseResult {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'body must be an object' }
  const b = raw as Record<string, unknown>

  if (typeof b.device_token !== 'string' || b.device_token.length < 8) {
    return { ok: false, error: 'device_token missing or too short' }
  }
  if (!num(b.ts)) return { ok: false, error: 'ts must be epoch ms' }
  // A node with a dead RTC posts 1970. Refuse it rather than plot it.
  if (b.ts < 1_600_000_000_000) return { ok: false, error: 'ts is implausibly old — check the node clock' }
  if (b.ts > now + 5 * 60_000) return { ok: false, error: 'ts is in the future' }

  for (const [key, [lo, hi]] of Object.entries(RANGES)) {
    const v = b[key]
    if (!num(v)) return { ok: false, error: `${key} must be a number` }
    if (v < lo || v > hi) return { ok: false, error: `${key}=${v} out of plausible range ${lo}..${hi}` }
  }

  return {
    ok: true,
    deviceToken: b.device_token,
    reading: {
      moisture: b.moisture as number,
      soilTemp: b.soil_temp as number,
      ec: b.ec as number,
      ph: b.ph as number,
      ts: b.ts,
    },
  }
}

export function toWire(reading: SensorReading, deviceToken: string): IngestBody {
  return {
    device_token: deviceToken,
    ts: reading.ts,
    moisture: reading.moisture,
    soil_temp: reading.soilTemp,
    ec: reading.ec,
    ph: reading.ph,
  }
}
