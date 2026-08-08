// Run: pnpm test
//
// The derived read models: one deriveVerdict for every consumer, the compact
// ?latest=1 payload, and the public projection's whitelist. What is pinned:
// the readings payload's events are detectEvents' verbatim, the compact shape
// carries no series, the verdict the ingest 202 sends equals the one the
// readings route serves for the same rows, and the public body leaks nothing
// private — including the 404 that refuses to distinguish "private" from
// "absent".

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  deriveVerdict,
  lastSeenBucket,
  latestPayload,
  profileForSource,
  publicPage,
  PUBLIC_NOT_FOUND,
  readingsPayload,
} from './derive.ts'
import {
  detectEvents,
  initialState,
  plantMood,
  stepState,
  type SensorReading,
} from './plant-mood.ts'
import { DEFAULT_SPECIES, speciesById } from './species.ts'
import { append, registerSource, upsertPlant, type PlantRecord } from './store.ts'

// The suite exercises the in-process backend. KV env leaking in from the
// shell would silently turn these into network tests — strip it up front.
delete process.env.KV_REST_API_URL
delete process.env.UPSTASH_REDIS_REST_URL
delete process.env.KV_REST_API_TOKEN
delete process.env.UPSTASH_REDIS_REST_TOKEN
delete process.env.VERCEL

const NOW = 1_754_650_000_000
const HOUR = 3_600_000
const pothos = speciesById('pothos')

/**
 * Twelve hourly pothos-plausible readings ending at NOW: a slow dry-down, one
 * watering jump (+15% at i=6) and one feed jump (+0.35 EC at i=7 with
 * moisture steady) — detectEvents must see exactly one of each.
 */
function series(): SensorReading[] {
  const moisture = [60, 59, 58, 57, 56, 55, 70, 69, 68, 67, 66, 65]
  return moisture.map((m, i) => ({
    moisture: m,
    soilTemp: 22.4,
    ec: i >= 7 ? 1.35 : 1.0,
    ph: 6.3,
    ts: NOW - (moisture.length - 1 - i) * HOUR,
  }))
}

/** A sawtooth that waters itself every other hour — more events than any cap. */
function sawtooth(): SensorReading[] {
  return Array.from({ length: 30 }, (_, i) => ({
    moisture: i % 2 === 0 ? 30 : 45,
    soilTemp: 22.4,
    ec: 1.0,
    ph: 6.3,
    ts: NOW - (29 - i) * HOUR,
  }))
}

const plant = (over: Partial<PlantRecord> = {}): PlantRecord => ({
  label: 'Pimenta Pepe',
  species: 'pothos',
  stage: null,
  sources: [],
  public: false,
  ...over,
})

// ── deriveVerdict ───────────────────────────────────────────────────────────

test('deriveVerdict: is exactly the initialState→stepState→plantMood replay', () => {
  const rows = series()
  let state = initialState(rows[0], 62)
  for (const r of rows) state = stepState(state, r, pothos)
  assert.deepEqual(
    deriveVerdict(rows, pothos, NOW),
    plantMood(rows[rows.length - 1], state, pothos, NOW),
  )
})

test('deriveVerdict: refuses an empty history — no data has no verdict', () => {
  assert.throws(() => deriveVerdict([], pothos, NOW), /empty history/)
})

test('deriveVerdict: the ingest 202 and the readings payload speak one verdict', () => {
  const rows = series()
  // What the ingest route serializes into the 202…
  const v = deriveVerdict(rows, DEFAULT_SPECIES, NOW)
  const ingest202 = { emotion: v.emotion, wellbeing: v.wellbeing, headline: v.headline }
  // …must equal what the readings route serves for the same rows.
  const mood = readingsPayload(rows, DEFAULT_SPECIES, NOW).mood!
  assert.deepEqual(ingest202, {
    emotion: mood.emotion,
    wellbeing: mood.wellbeing,
    headline: mood.headline,
  })
  // And the compact shape carries the identical mood — three surfaces, one math.
  assert.deepEqual(latestPayload(rows, DEFAULT_SPECIES, NOW).mood, mood)
})

// ── /api/readings payloads ──────────────────────────────────────────────────

test('readings payload: events are detectEvents(rows), verbatim', () => {
  const rows = series()
  const p = readingsPayload(rows, pothos, NOW)
  assert.deepEqual(p.events, detectEvents(rows))
  assert.deepEqual(
    p.events.map((e) => e.kind),
    ['water', 'feed'],
    'the fixture must actually exercise both event kinds',
  )
  assert.equal(p.paired, true)
  assert.equal(p.count, rows.length)
  assert.equal(p.series.length, rows.length)
  assert.deepEqual(p.latest, rows[rows.length - 1])
})

test('latest payload: compact shape has no series and hoists wellbeing', () => {
  const rows = series()
  const p = latestPayload(rows, pothos, NOW)
  assert.ok(!('series' in p), '?latest=1 must not drag the curve along')
  assert.equal(p.paired, true)
  assert.equal(p.wellbeing, p.mood!.wellbeing)
  assert.deepEqual(p.latest, rows[rows.length - 1])
  assert.equal(p.count, rows.length)
  assert.deepEqual(
    Object.keys(p).sort(),
    ['count', 'events', 'latest', 'mood', 'paired', 'profile', 'wellbeing'],
  )
})

test('latest payload: events are capped to the last 10, oldest dropped first', () => {
  const rows = sawtooth()
  const all = detectEvents(rows)
  assert.ok(all.length > 10, 'the fixture must overflow the cap')
  const p = latestPayload(rows, pothos, NOW)
  assert.equal(p.events.length, 10)
  assert.deepEqual(p.events, all.slice(-10))
})

test('payloads: unpaired token answers honestly in both shapes', () => {
  assert.deepEqual(readingsPayload([], pothos, NOW), {
    paired: false,
    profile: 'pothos',
    latest: null,
    mood: null,
    series: [],
    events: [],
    count: 0,
  })
  assert.deepEqual(latestPayload([], pothos, NOW), {
    paired: false,
    profile: 'pothos',
    latest: null,
    mood: null,
    wellbeing: null,
    events: [],
    count: 0,
  })
})

// ── profileForSource ────────────────────────────────────────────────────────

test('profileForSource: unregistered legacy token gets the default profile', async () => {
  assert.equal(await profileForSource('pf_demo_token_unregistered'), DEFAULT_SPECIES)
})

test('profileForSource: a registered source is judged as its plant', async () => {
  await upsertPlant('plt_derive_fern', plant({ species: 'fern' }))
  await registerSource('src_derive_fern_00000000', {
    plant_id: 'plt_derive_fern',
    adapter: 'thcphs-esp32',
    claimed_at: NOW,
  })
  assert.equal(await profileForSource('src_derive_fern_00000000'), speciesById('fern'))
})

test('profileForSource: a source pointing at a missing plant refuses', async () => {
  await registerSource('src_derive_orphan_000000', {
    plant_id: 'plt_never_created',
    adapter: 'thcphs-esp32',
    claimed_at: NOW,
  })
  await assert.rejects(() => profileForSource('src_derive_orphan_000000'), /missing plant/)
})

// ── the public projection ───────────────────────────────────────────────────

test('lastSeenBucket: coarse on purpose, boundaries pinned', () => {
  assert.equal(lastSeenBucket(0), 'now')
  assert.equal(lastSeenBucket(5 * 60_000 - 1), 'now')
  assert.equal(lastSeenBucket(5 * 60_000), 'minutes')
  assert.equal(lastSeenBucket(60 * 60_000 - 1), 'minutes')
  assert.equal(lastSeenBucket(60 * 60_000), 'hours')
  assert.equal(lastSeenBucket(24 * 60 * 60_000 - 1), 'hours')
  assert.equal(lastSeenBucket(24 * 60 * 60_000), 'days')
})

test('public page: serves the seven-field whitelist and leaks nothing', async () => {
  const token = 'src_public_pepe_00000000'
  const rows = series()
  await upsertPlant('plt_public_pepe', plant({ public: true, sources: [token] }), 'pepe-publico')
  await registerSource(token, { plant_id: 'plt_public_pepe', adapter: 'thcphs-esp32', claimed_at: NOW })
  for (const r of rows) await append(token, r)

  const page = await publicPage('pepe-publico', NOW)
  assert.equal(page.status, 200)
  const body = page.body
  assert.deepEqual(
    Object.keys(body).sort(),
    ['careCounts', 'emotion', 'headline', 'label', 'lastSeen', 'species', 'wellbeing'],
  )

  // Nothing private survives serialization: no tokens, no field names from
  // the wire contract, no timestamp more precise than the bucket.
  const s = JSON.stringify(body)
  for (const needle of ['src_', 'device_token', 'source_token', 'sources', '"ts"']) {
    assert.ok(!s.includes(needle), `public body must not contain "${needle}" (got: ${s})`)
  }
  for (const r of rows) {
    assert.ok(!s.includes(String(r.ts)), 'no raw timestamp may leak past the bucket')
  }

  assert.equal(body.label, 'Pimenta Pepe')
  assert.equal(body.species, 'pothos')
  assert.equal(body.lastSeen, 'now')
  assert.deepEqual(body.careCounts, { water: 1, feed: 1 })
  const verdict = deriveVerdict(rows, pothos, NOW)
  assert.equal(body.emotion, verdict.emotion)
  assert.equal(body.headline, verdict.headline)
  assert.equal(body.wellbeing, Math.round(verdict.wellbeing))
  assert.ok(Number.isInteger(body.wellbeing), 'public wellbeing is rounded, not raw')
})

test('public page: private, nonexistent and silent plants share ONE 404 body', async () => {
  await upsertPlant('plt_private_one', plant({ public: false, sources: ['src_priv_000000000000000'] }), 'private-plant')
  await upsertPlant('plt_silent_one', plant({ public: true, sources: ['src_silent_00000000000000'] }), 'silent-plant')

  const priv = await publicPage('private-plant', NOW)
  const missing = await publicPage('never-minted-slug', NOW)
  const silent = await publicPage('silent-plant', NOW)

  for (const page of [priv, missing, silent]) assert.equal(page.status, 404)
  // Identity, not similarity: byte-equal bodies or the 404 becomes an oracle.
  assert.equal(JSON.stringify(priv.body), JSON.stringify(missing.body))
  assert.equal(JSON.stringify(silent.body), JSON.stringify(missing.body))
  assert.deepEqual(missing.body, PUBLIC_NOT_FOUND)
})
