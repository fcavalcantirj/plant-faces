// Derived read models — ONE verdict replay for every consumer.
//
// Three surfaces answer "how is this plant doing?": GET /api/readings (the
// HUD), the 202 body of POST /api/ingest (so a node hears the verdict its own
// reading caused, without a second request), and GET /api/public/[slug] (the
// shareable page). They must never disagree, so the replay lives here once:
// initialState → stepState over every stored row → plantMood, the same pure
// functions the tests pin. A route computing its own variant is how two faces
// end up telling two stories about one pot.
//
// The value imports carry explicit .ts extensions because lib code runs under
// node --experimental-strip-types in tests, whose resolver requires them.

import type { Emotion } from './face-points'
import {
  detectEvents,
  deriveSeries,
  initialState,
  plantMood,
  stepState,
  type CareEvent,
  type MoodResult,
  type SensorReading,
  type SeriesPoint,
} from './plant-mood.ts'
import { DEFAULT_SPECIES, speciesById, withStage, type SpeciesProfile } from './species.ts'
import { getPlant, getPlantBySlug, getSource, readings } from './store.ts'

/**
 * Where a replayed history starts. deriveSeries defaults to the same value;
 * passing it explicitly here keeps the curve's first point and the verdict's
 * accumulator on one constant that cannot drift apart.
 */
const START_WELLBEING = 62

/**
 * Replay every stored reading into the current verdict. This is THE verdict
 * computation — /api/readings, the ingest 202 and the public page all call
 * it, so the mood a node hears when it posts is the mood the HUD shows a
 * second later. `now` is the staleness clock: wall time for real callers, the
 * last reading's ts for ?replay=1. An empty history has no verdict and is
 * refused — callers decide what "no data" means on their surface.
 */
export function deriveVerdict(
  rows: SensorReading[],
  profile: SpeciesProfile,
  now: number,
): MoodResult {
  if (rows.length === 0) {
    throw new Error('deriveVerdict needs at least one reading — an empty history has no verdict')
  }
  let state = initialState(rows[0], START_WELLBEING)
  for (const r of rows) state = stepState(state, r, profile)
  return plantMood(rows[rows.length - 1], state, profile, now)
}

// ── /api/readings payloads ──────────────────────────────────────────────────

export interface ReadingsPayload {
  paired: boolean
  profile: string
  latest: SensorReading | null
  mood: MoodResult | null
  series: SeriesPoint[]
  events: CareEvent[]
  count: number
}

export interface LatestPayload {
  paired: boolean
  profile: string
  latest: SensorReading | null
  mood: MoodResult | null
  wellbeing: number | null
  events: CareEvent[]
  count: number
}

/** How many care events the compact payload carries — "recently", not "ever". */
const LATEST_EVENTS = 10

/** The full response: curve, verdict and the care events the soil witnessed. */
export function readingsPayload(
  rows: SensorReading[],
  profile: SpeciesProfile,
  now: number,
): ReadingsPayload {
  if (rows.length === 0) {
    return {
      paired: false,
      profile: profile.id,
      latest: null,
      mood: null,
      series: [],
      events: [],
      count: 0,
    }
  }
  return {
    paired: true,
    profile: profile.id,
    latest: rows[rows.length - 1],
    mood: deriveVerdict(rows, profile, now),
    series: deriveSeries(rows, profile, START_WELLBEING),
    events: detectEvents(rows),
    count: rows.length,
  }
}

/**
 * ?latest=1 — the polling shape. Everything a checker-in needs and NO series:
 * a face asking "how are you" every minute must not drag two weeks of curve
 * with it. `wellbeing` is hoisted out of the mood because it is the one
 * number most pollers want; null when unpaired, never a made-up baseline.
 */
export function latestPayload(
  rows: SensorReading[],
  profile: SpeciesProfile,
  now: number,
): LatestPayload {
  if (rows.length === 0) {
    return {
      paired: false,
      profile: profile.id,
      latest: null,
      mood: null,
      wellbeing: null,
      events: [],
      count: 0,
    }
  }
  const mood = deriveVerdict(rows, profile, now)
  return {
    paired: true,
    profile: profile.id,
    latest: rows[rows.length - 1],
    mood,
    wellbeing: mood.wellbeing,
    events: detectEvents(rows).slice(-LATEST_EVENTS),
    count: rows.length,
  }
}

// ── which species (and stage) judges a token ────────────────────────────────

export interface SourceJudgement {
  /** The base species profile — stage bands NOT yet applied. */
  profile: SpeciesProfile
  stage: string | null
  registered: boolean
}

/**
 * A registered source is judged as the plant it belongs to — species AND
 * growth stage, both from the registry; an unregistered (demo/legacy) token
 * gets the default profile, stageless. The base profile and the stage travel
 * separately so a caller can hand them to computeStats as-is; withStage
 * marries them at the point of judgment. A source row pointing at a missing
 * plant is corruption and refuses loudly, exactly like the slug indirection
 * in store.ts: guessing a species for a real plant is not an option.
 */
export async function judgementForSource(token: string): Promise<SourceJudgement> {
  const source = await getSource(token)
  if (source === null) return { profile: DEFAULT_SPECIES, stage: null, registered: false }
  const plant = await getPlant(source.plant_id)
  if (plant === null) {
    throw new Error(
      `registry source ${token} points at missing plant ${source.plant_id} — refusing to guess a species`,
    )
  }
  return { profile: speciesById(plant.species), stage: plant.stage, registered: true }
}

/** The judged profile in one call — stage bands applied, for the ingest 202. */
export async function profileForSource(token: string): Promise<SpeciesProfile> {
  const j = await judgementForSource(token)
  return withStage(j.profile, j.stage)
}

// ── the public projection ───────────────────────────────────────────────────

export type LastSeenBucket = 'now' | 'minutes' | 'hours' | 'days'

/**
 * Coarse recency. An exact timestamp on a public page would fingerprint the
 * node's posting cadence; a bucket answers the only public question — "is
 * anyone home?" — and nothing else.
 */
export function lastSeenBucket(ageMs: number): LastSeenBucket {
  if (ageMs < 5 * 60_000) return 'now'
  if (ageMs < 60 * 60_000) return 'minutes'
  if (ageMs < 24 * 60 * 60_000) return 'hours'
  return 'days'
}

/** The whitelist. Nothing outside these seven fields leaves the door. */
export interface PublicProjection {
  label: string
  species: string
  emotion: Emotion
  wellbeing: number
  headline: string
  lastSeen: LastSeenBucket
  careCounts: { water: number; feed: number }
}

/**
 * The one 404 body. Unknown slug, private plant and never-posted plant all
 * serve THIS object, so the response cannot be used to probe which slugs
 * exist. Distinguishability is the leak; identity is the defense.
 */
export const PUBLIC_NOT_FOUND = { error: 'not found' } as const

export type PublicPageResult =
  | { status: 200; body: PublicProjection }
  | { status: 404; body: typeof PUBLIC_NOT_FOUND }

/**
 * Resolve a public slug to its projection. Whitelist-only by construction:
 * the body is built field by field from the verdict and the plant's public
 * face — tokens, sources, raw timestamps, series and the verdict's numeric
 * `reason` never enter it.
 */
export async function publicPage(slug: string, now: number): Promise<PublicPageResult> {
  const hit = await getPlantBySlug(slug)
  if (hit === null || hit.plant.public !== true) return { status: 404, body: PUBLIC_NOT_FOUND }

  // A plant owns 1..N sources; today's mints create exactly one, and merging
  // by timestamp keeps the replay meaningful when more arrive.
  const rows: SensorReading[] = []
  for (const token of hit.plant.sources) rows.push(...(await readings(token)))
  rows.sort((a, b) => a.ts - b.ts)

  // Public but never posted: there is no truthful verdict to show, and a
  // special "enrolled, silent" body would leak more than the same 404 does.
  if (rows.length === 0) return { status: 404, body: PUBLIC_NOT_FOUND }

  // The registry's stage picks the bands, the same as every other surface.
  const verdict = deriveVerdict(rows, withStage(speciesById(hit.plant.species), hit.plant.stage), now)
  const events = detectEvents(rows)
  return {
    status: 200,
    body: {
      label: hit.plant.label,
      species: hit.plant.species,
      emotion: verdict.emotion,
      wellbeing: Math.round(verdict.wellbeing),
      headline: verdict.headline,
      lastSeen: lastSeenBucket(now - rows[rows.length - 1].ts),
      careCounts: {
        water: events.filter((e) => e.kind === 'water').length,
        feed: events.filter((e) => e.kind === 'feed').length,
      },
    },
  }
}
