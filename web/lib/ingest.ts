// The ingestion contract.
//
// The ORIGINAL wire shape, posted by the simulator today and by the real node
// tomorrow — an ESP32 reading a ComWinTop THCPH-S over RS485 (ESPHome
// modbus_controller + MAX485). They are interchangeable by construction: if the
// sim can drive the app through this endpoint, so can the probe.
//
//   POST /api/ingest
//   { "device_token": "...", "ts": 1750000000000,
//     "moisture": 42.1, "soil_temp": 22.4, "ec": 1.15, "ph": 6.3 }
//
// snake_case on the wire (it is what an ESPHome lambda emits most naturally),
// camelCase inside. The token is what makes a reading VERIFIED rather than
// claimed — the anti-cheat leg of any future leaderboard. Verify at the source.
//
// Envelope v1 — the modular, multi-source shape — lives further down this
// file; `parseAnyIngest` is the one entry point that speaks both.

import type { SensorReading } from './plant-mood'
import { validateChannels, type ChannelValues } from './channels.ts'

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

// ── envelope v1 ─────────────────────────────────────────────────────────────
//
// The modular door. A SOURCE — our probe, a Tuya air sensor, a backfill
// script — posts named channels through the same endpoint:
//
//   POST /api/ingest
//   { "source_token": "src_...", "ts": 1754650000000,
//     "channels": { "soil_moisture_pct": 42.1, "soil_temp_c": 22.4,
//                   "soil_ec_ms_cm": 1.15, "soil_ph": 6.3 },
//     "meta": { "firmware": "plant-node-0.1", "adapter": "thcphs-esp32",
//               "calibration": "factory" } }
//
// Channel names and rails live in channels.ts — one registry row per sensor
// capability. Detection is structural: a body with a `channels` key is an
// envelope, a body with `device_token` is the legacy shape above. The legacy
// code path is untouched — parseIngest keeps its exact behavior — and its
// result is MAPPED to an envelope, so everything downstream speaks one shape.

export interface EnvelopeMeta {
  firmware?: string
  adapter?: string
  calibration?: string
}

export interface Envelope {
  sourceToken: string
  ts: number
  channels: ChannelValues
  meta: EnvelopeMeta
}

export type AnyParseResult =
  | ({ ok: true; legacyReading?: SensorReading } & Envelope)
  | { ok: false; error: string }

const META_KEYS = ['firmware', 'adapter', 'calibration'] as const

/**
 * Meta is provenance, not measurement — but the honesty gate still applies:
 * an unrecognized meta field is refused by name rather than silently dropped.
 */
function parseMeta(v: unknown): { ok: true; meta: EnvelopeMeta } | { ok: false; error: string } {
  if (v === undefined) return { ok: true, meta: {} }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    return { ok: false, error: 'meta must be an object' }
  }
  const m = v as Record<string, unknown>
  const meta: EnvelopeMeta = {}
  for (const k of Object.keys(m)) {
    if (!(META_KEYS as readonly string[]).includes(k)) {
      return { ok: false, error: `meta.${k} is not a recognized meta field` }
    }
    const s = m[k]
    if (typeof s !== 'string') return { ok: false, error: `meta.${k} must be a string` }
    meta[k as (typeof META_KEYS)[number]] = s
  }
  return { ok: true, meta }
}

/** Same rails as the legacy parser: refuse, never coerce. */
function parseEnvelope(b: Record<string, unknown>, now: number): AnyParseResult {
  if (typeof b.source_token !== 'string' || b.source_token.length < 8) {
    return { ok: false, error: 'source_token missing or too short' }
  }
  if (!num(b.ts)) return { ok: false, error: 'ts must be epoch ms' }
  // A source with a dead clock posts 1970. Refuse it rather than plot it.
  if (b.ts < 1_600_000_000_000) return { ok: false, error: 'ts is implausibly old — check the source clock' }
  if (b.ts > now + 5 * 60_000) return { ok: false, error: 'ts is in the future' }

  if (typeof b.channels !== 'object' || b.channels === null || Array.isArray(b.channels)) {
    return { ok: false, error: 'channels must be an object' }
  }
  const ch = validateChannels(b.channels as Record<string, unknown>)
  if (!ch.ok) return ch
  if (Object.keys(ch.channels).length === 0) {
    return { ok: false, error: 'channels must not be empty — a post with no measurements is not a reading' }
  }

  const meta = parseMeta(b.meta)
  if (!meta.ok) return meta

  return { ok: true, sourceToken: b.source_token, ts: b.ts, channels: ch.channels, meta: meta.meta }
}

/** Map a validated legacy reading to envelope shape — the thcphs-v0 adapter. */
export function legacyToEnvelope(deviceToken: string, reading: SensorReading): Envelope {
  return {
    sourceToken: deviceToken,
    ts: reading.ts,
    channels: {
      soil_moisture_pct: reading.moisture,
      soil_temp_c: reading.soilTemp,
      soil_ec_ms_cm: reading.ec,
      soil_ph: reading.ph,
    },
    meta: { adapter: 'thcphs-v0' },
  }
}

/**
 * The four soil channels, when ALL present, reconstitute a SensorReading for
 * the mood pipeline. Partial soil data does not: the engine judges a reading,
 * not a fragment. Air-only envelopes return undefined — they are archive
 * material, not verdicts.
 */
export function soilReadingOf(env: Envelope): SensorReading | undefined {
  const { soil_moisture_pct, soil_temp_c, soil_ec_ms_cm, soil_ph } = env.channels
  if (
    soil_moisture_pct === undefined ||
    soil_temp_c === undefined ||
    soil_ec_ms_cm === undefined ||
    soil_ph === undefined
  ) {
    return undefined
  }
  return { moisture: soil_moisture_pct, soilTemp: soil_temp_c, ec: soil_ec_ms_cm, ph: soil_ph, ts: env.ts }
}

/**
 * The one entry point for both wire shapes. The legacy branch delegates to
 * parseIngest untouched, so existing firmware keeps its exact contract, and
 * `legacyReading` carries parseIngest's own SensorReading through verbatim —
 * the store path for legacy bodies stays byte-identical.
 */
export function parseAnyIngest(raw: unknown, now: number): AnyParseResult {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'body must be an object' }
  const b = raw as Record<string, unknown>

  if ('channels' in b) return parseEnvelope(b, now)
  if ('device_token' in b) {
    const legacy = parseIngest(raw, now)
    if (!legacy.ok) return legacy
    return { ok: true, ...legacyToEnvelope(legacy.deviceToken, legacy.reading), legacyReading: legacy.reading }
  }
  return { ok: false, error: 'unrecognized body: expected envelope ("channels") or legacy ("device_token") shape' }
}
