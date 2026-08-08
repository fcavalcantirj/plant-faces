// Run: pnpm test
//
// The channel registry and the envelope door. What is pinned here: both wire
// shapes parse through parseAnyIngest, the legacy path stays byte-identical to
// parseIngest, and every refusal names its channel — refuse, never clamp.

import test from 'node:test'
import assert from 'node:assert/strict'
import { CHANNELS, validateChannels, type ChannelSpec } from './channels.ts'
import { TRUST } from './species.ts'
import { legacyToEnvelope, parseAnyIngest, parseIngest, soilReadingOf } from './ingest.ts'

const NOW = 1_754_650_000_000

function envelope(over: Record<string, unknown> = {}) {
  return {
    source_token: 'src_0123456789abcdef',
    ts: NOW - 60_000,
    channels: {
      soil_moisture_pct: 42.1,
      soil_temp_c: 22.4,
      soil_ec_ms_cm: 1.15,
      soil_ph: 6.3,
    },
    ...over,
  }
}

function legacyBody(over: Record<string, unknown> = {}) {
  return {
    device_token: 'pf_demo_token',
    ts: NOW - 60_000,
    moisture: 42.1,
    soil_temp: 22.4,
    ec: 1.15,
    ph: 6.3,
    ...over,
  }
}

// ── registry ────────────────────────────────────────────────────────────────

test('registry: soil channel trust mirrors the species TRUST grading', () => {
  assert.equal(CHANNELS.soil_moisture_pct.trust, TRUST.moisture)
  assert.equal(CHANNELS.soil_temp_c.trust, TRUST.soilTemp)
  assert.equal(CHANNELS.soil_ec_ms_cm.trust, TRUST.ec)
  assert.equal(CHANNELS.soil_ph.trust, TRUST.ph)
})

test('validateChannels: unknown channel is refused by name', () => {
  const r = validateChannels({ soil_moisture_pct: 42, co2_ppm: 800 })
  assert.ok(!r.ok, 'unknown channel must be refused')
  assert.ok(r.error.includes('co2_ppm'), `error must name the channel (got: ${r.error})`)
})

test('validateChannels: inherited object keys are not registry entries', () => {
  // "toString" exists on Object.prototype; a naive lookup would find it and
  // then score a function as a spec. Own-property check keeps it unknown.
  const r = validateChannels({ toString: 1 })
  assert.ok(!r.ok)
  assert.ok(r.error.includes('toString'))
})

test('validateChannels: every channel refuses out-of-range by name — never clamps', () => {
  for (const [name, spec] of Object.entries(CHANNELS) as [string, ChannelSpec][]) {
    for (const bad of [spec.min - 0.01, spec.max + 0.01]) {
      const r = validateChannels({ [name]: bad })
      assert.ok(!r.ok, `${name}=${bad} must be refused`)
      assert.ok(r.error.includes(name), `refusal must name ${name} (got: ${r.error})`)
    }
    // The rails themselves are plausible: boundary values pass untouched.
    assert.ok(validateChannels({ [name]: spec.min }).ok)
    assert.ok(validateChannels({ [name]: spec.max }).ok)
  }
})

test('validateChannels: a non-number value is refused, not coerced', () => {
  for (const bad of [NaN, Infinity, '42', null, true]) {
    const r = validateChannels({ soil_moisture_pct: bad })
    assert.ok(!r.ok, `${String(bad)} must be refused`)
    assert.ok(r.error.includes('soil_moisture_pct'))
  }
})

// ── envelope v1 ─────────────────────────────────────────────────────────────

test('envelope: a well-formed body is accepted with channels and meta intact', () => {
  const body = envelope({ meta: { firmware: 'plant-node-0.1', adapter: 'thcphs-esp32' } })
  const r = parseAnyIngest(body, NOW)
  assert.ok(r.ok, r.ok ? '' : r.error)
  assert.equal(r.sourceToken, 'src_0123456789abcdef')
  assert.equal(r.ts, NOW - 60_000)
  assert.equal(r.channels.soil_moisture_pct, 42.1)
  assert.equal(r.meta.adapter, 'thcphs-esp32')
  assert.equal(r.legacyReading, undefined)
})

test('envelope: all four soil channels reconstitute the SensorReading', () => {
  const r = parseAnyIngest(envelope(), NOW)
  assert.ok(r.ok)
  assert.deepEqual(soilReadingOf(r), {
    moisture: 42.1,
    soilTemp: 22.4,
    ec: 1.15,
    ph: 6.3,
    ts: NOW - 60_000,
  })
})

test('envelope: air-only body is accepted and yields no soil reading', () => {
  const r = parseAnyIngest(envelope({ channels: { air_temp_c: 27.9, rh_pct: 61.2 } }), NOW)
  assert.ok(r.ok, r.ok ? '' : r.error)
  assert.equal(r.channels.air_temp_c, 27.9)
  assert.equal(soilReadingOf(r), undefined)
})

test('envelope: partial soil is not a reading either', () => {
  // Three of four soil channels: valid envelope, but the mood pipeline judges
  // whole readings, not fragments.
  const r = parseAnyIngest(
    envelope({ channels: { soil_moisture_pct: 42.1, soil_temp_c: 22.4, soil_ec_ms_cm: 1.15 } }),
    NOW,
  )
  assert.ok(r.ok)
  assert.equal(soilReadingOf(r), undefined)
})

test('envelope: unknown channel is refused with its name', () => {
  const r = parseAnyIngest(envelope({ channels: { soil_moisture_pct: 42, light_lux: 9000 } }), NOW)
  assert.ok(!r.ok)
  assert.ok(r.error.includes('light_lux'), r.ok ? '' : r.error)
})

test('envelope: empty channels are refused', () => {
  const r = parseAnyIngest(envelope({ channels: {} }), NOW)
  assert.ok(!r.ok)
  assert.ok(r.error.includes('empty'))
})

test('envelope: source_token rails match the legacy token rails', () => {
  for (const bad of [undefined, 12345, 'short']) {
    const r = parseAnyIngest(envelope({ source_token: bad }), NOW)
    assert.ok(!r.ok, `source_token=${String(bad)} must be refused`)
    assert.ok(r.error.includes('source_token'))
  }
})

test('envelope: ts rails match the legacy door', () => {
  assert.ok(!parseAnyIngest(envelope({ ts: '123' }), NOW).ok)
  assert.ok(!parseAnyIngest(envelope({ ts: 0 }), NOW).ok, '1970 clock must be refused')
  assert.ok(!parseAnyIngest(envelope({ ts: NOW + 6 * 60_000 }), NOW).ok, 'future ts must be refused')
  assert.ok(parseAnyIngest(envelope({ ts: NOW + 4 * 60_000 }), NOW).ok, 'small skew is tolerated')
})

test('envelope: meta must be an object of known string fields', () => {
  assert.ok(!parseAnyIngest(envelope({ meta: 'factory' }), NOW).ok)
  assert.ok(!parseAnyIngest(envelope({ meta: { firmware: 5 } }), NOW).ok)
  const unknown = parseAnyIngest(envelope({ meta: { vibe: 'good' } }), NOW)
  assert.ok(!unknown.ok)
  assert.ok(unknown.error.includes('vibe'), 'unrecognized meta field is refused by name')
})

// ── legacy mapping ──────────────────────────────────────────────────────────

test('legacy: body parses and maps to the thcphs-v0 envelope', () => {
  const r = parseAnyIngest(legacyBody(), NOW)
  assert.ok(r.ok, r.ok ? '' : r.error)
  assert.equal(r.sourceToken, 'pf_demo_token')
  assert.deepEqual(r.channels, {
    soil_moisture_pct: 42.1,
    soil_temp_c: 22.4,
    soil_ec_ms_cm: 1.15,
    soil_ph: 6.3,
  })
  assert.deepEqual(r.meta, { adapter: 'thcphs-v0' })
})

test('legacy: path is parseIngest verbatim — same reading, same errors', () => {
  const direct = parseIngest(legacyBody(), NOW)
  const routed = parseAnyIngest(legacyBody(), NOW)
  assert.ok(direct.ok && routed.ok)
  assert.deepEqual(routed.legacyReading, direct.reading)
  assert.deepEqual(legacyToEnvelope(direct.deviceToken, direct.reading).channels, routed.channels)

  // Refusals flow through with the exact legacy error text.
  const badDirect = parseIngest(legacyBody({ moisture: 120 }), NOW)
  const badRouted = parseAnyIngest(legacyBody({ moisture: 120 }), NOW)
  assert.ok(!badDirect.ok && !badRouted.ok)
  assert.equal(badRouted.error, badDirect.error)
})

test('detection: a `channels` key means envelope, even beside a device_token', () => {
  // Structural detection must not fall back to the legacy parser when the
  // envelope is malformed — that would be a silent shape change.
  const r = parseAnyIngest(legacyBody({ channels: { air_temp_c: 25 } }), NOW)
  assert.ok(!r.ok)
  assert.ok(r.error.includes('source_token'))
})

test('detection: a body with neither shape is refused, naming both', () => {
  const r = parseAnyIngest({ ts: NOW, moisture: 42 }, NOW)
  assert.ok(!r.ok)
  assert.ok(r.error.includes('channels') && r.error.includes('device_token'))
})
