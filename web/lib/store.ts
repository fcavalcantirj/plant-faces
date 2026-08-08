// Reading store.
//
// Two backends, chosen by environment, same interface:
//
//   • Upstash/Vercel KV (Redis over REST) when KV_REST_API_URL is set — this is
//     what production uses. Serverless functions share NO memory: a reading
//     POSTed to one instance is invisible to a GET on the next, so an in-process
//     Map would make the deployed demo randomly claim the probe was silent.
//   • An in-process Map otherwise, so local dev and `pnpm test` need no infra.
//
// Talks to Upstash over its REST command API with plain fetch — no SDK, no new
// dependency. Readings live in a sorted set scored by timestamp, so appends are
// atomic and two POSTs racing cannot clobber each other (a read-modify-write of
// a JSON blob would).

import type { SensorReading } from './plant-mood'

/** ~2 weeks at the node's planned 15-min cadence. */
const MAX_READINGS = 1400
/**
 * Demo pots are not archives. Let an idle UNREGISTERED one evaporate —
 * registered sources are real plants and keep their history (see the registry
 * section below for the split).
 */
const TTL_SECONDS = 24 * 60 * 60

const kvUrl = () => process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
const kvToken = () => process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN

export const usingKv = () => Boolean(kvUrl() && kvToken())

/**
 * `memory` is correct locally and FATAL in production.
 *
 * On serverless the in-process Map is not shared between function instances, so
 * a deploy without KV does not fail — it works about half the time and tells the
 * visitor the probe went quiet. That is the worst possible failure: a lie that
 * looks like data. So a deployed instance with no KV configured refuses to store
 * anything at all and says why.
 */
export function storeMode(): 'kv' | 'memory' | 'misconfigured' {
  if (usingKv()) return 'kv'
  return process.env.VERCEL ? 'misconfigured' : 'memory'
}

const key = (deviceToken: string) => `pf:readings:${deviceToken}`

/** One Upstash REST call. Returns the `result` field, or throws. */
async function redis(cmd: (string | number)[]): Promise<unknown> {
  const res = await fetch(kvUrl()!, {
    method: 'POST',
    headers: { Authorization: `Bearer ${kvToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`kv ${cmd[0]} failed: ${res.status} ${await res.text()}`)
  const json = (await res.json()) as { result?: unknown; error?: string }
  if (json.error) throw new Error(`kv ${cmd[0]}: ${json.error}`)
  return json.result
}

// ── in-memory fallback ──────────────────────────────────────────────────────

const mem = new Map<string, SensorReading[]>()

function memAppend(deviceToken: string, reading: SensorReading): number {
  const list = mem.get(deviceToken) ?? []
  const at = list.findIndex((r) => r.ts === reading.ts)
  if (at >= 0) list[at] = reading
  else list.push(reading)
  list.sort((a, b) => a.ts - b.ts)
  if (list.length > MAX_READINGS) list.splice(0, list.length - MAX_READINGS)
  mem.set(deviceToken, list)
  return list.length
}

// ── public interface ────────────────────────────────────────────────────────

export async function append(sourceToken: string, reading: SensorReading): Promise<number> {
  const mode = storeMode()
  if (mode === 'misconfigured') {
    throw new Error(
      'no durable store: deployed without KV_REST_API_URL/KV_REST_API_TOKEN. ' +
        'Serverless instances share no memory, so readings would vanish at random.',
    )
  }
  // The memory backend has no TTL to skip, so it never consults the registry —
  // local appends stay free of any extra lookup.
  if (mode === 'memory') return memAppend(sourceToken, reading)

  // ONE registry lookup, decided up front. append runs once per reading; the
  // retention branch costs exactly one extra round-trip, never one per Redis
  // command below.
  const expire = await shouldExpire(sourceToken)

  const k = key(sourceToken)
  // Idempotent on timestamp: drop any existing member at this score first, so a
  // node retrying a POST cannot double-plot itself.
  await redis(['ZREMRANGEBYSCORE', k, reading.ts, reading.ts])
  await redis(['ZADD', k, reading.ts, JSON.stringify(reading)])
  // Trim oldest-first.
  await redis(['ZREMRANGEBYRANK', k, 0, -(MAX_READINGS + 1)])
  if (expire) {
    // Unregistered tokens are demos: refresh the idle clock, exactly as before.
    await redis(['EXPIRE', k, TTL_SECONDS])
  } else {
    // Registered plants keep their history. Skipping EXPIRE alone is not
    // enough: a token registered AFTER it started posting still carries the
    // demo TTL its early appends set, and that old clock would quietly run
    // out. PERSIST clears it — registration must actually mean survival.
    await redis(['PERSIST', k])
  }
  const n = await redis(['ZCARD', k])
  return typeof n === 'number' ? n : 0
}

export async function readings(deviceToken: string): Promise<SensorReading[]> {
  const mode = storeMode()
  if (mode === 'misconfigured') return []
  if (mode === 'memory') return mem.get(deviceToken) ?? []

  const rows = (await redis(['ZRANGE', key(deviceToken), 0, -1])) as string[] | null
  if (!rows?.length) return []
  const out: SensorReading[] = []
  for (const raw of rows) {
    try {
      out.push(JSON.parse(raw) as SensorReading)
    } catch {
      // A malformed member is dropped rather than crashing the read: one bad
      // row must never take the whole history down.
    }
  }
  return out.sort((a, b) => a.ts - b.ts)
}

export async function reset(deviceToken: string): Promise<void> {
  if (!usingKv()) {
    mem.delete(deviceToken)
    return
  }
  await redis(['DEL', key(deviceToken)])
}

// ── source / plant registry ─────────────────────────────────────────────────
//
// What separates a REGISTERED plant from a drive-by demo. Same dual backend as
// the readings, three key families:
//
//   pf:source:<token>  → { plant_id, adapter, claimed_at }          who posts
//   pf:plant:<id>      → { label, species, stage, sources, public } who it is
//   pf:slug:<slug>     → plant_id                              public name → id
//
// Registration changes exactly one storage behavior: a registered source's
// readings key gets NO idle TTL, because a real plant's history must not
// evaporate over a quiet day. Unregistered tokens keep the 24h demo TTL. (The
// MAX_READINGS hot-window cap still applies to everyone — durable archival is
// a different store's job.) Rows are minted only through the admin route
// (/api/devices via lib/devices.ts); nothing here invents registry state.
//
// Registry ops REFUSE on a misconfigured deploy — reads included. readings()
// can honestly answer "nothing stored", but a registry answering "not
// registered" because there is no store would silently demote a real plant to
// demo retention: a lie that looks like an answer.

export interface SourceRecord {
  plant_id: string
  adapter: string
  claimed_at: number
}

export interface PlantRecord {
  label: string
  species: string
  stage: string | null
  sources: string[]
  public: boolean
}

/** Thrown when a mint tries to claim a slug that already names another plant. */
export class SlugTakenError extends Error {}

const sourceKey = (token: string) => `pf:source:${token}`
const plantKey = (id: string) => `pf:plant:${id}`
const slugKey = (slug: string) => `pf:slug:${slug}`

const memSources = new Map<string, SourceRecord>()
const memPlants = new Map<string, PlantRecord>()
const memSlugs = new Map<string, string>()

function registryMode(): 'kv' | 'memory' {
  const mode = storeMode()
  if (mode === 'misconfigured') {
    throw new Error(
      'no durable store for the registry: deployed without KV_REST_API_URL/KV_REST_API_TOKEN.',
    )
  }
  return mode
}

/**
 * A registry row that no longer parses cannot be dropped the way a bad reading
 * is: pretending it is absent would flip a real plant back to demo retention.
 * Corruption is refused loudly instead.
 */
function parseRecord<T>(raw: unknown, k: string): T | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'string') throw new Error(`registry ${k} holds a non-string value`)
  try {
    return JSON.parse(raw) as T
  } catch {
    throw new Error(`registry ${k} is corrupt JSON — refusing to guess`)
  }
}

export async function registerSource(token: string, record: SourceRecord): Promise<void> {
  if (registryMode() === 'memory') {
    memSources.set(token, record)
    return
  }
  await redis(['SET', sourceKey(token), JSON.stringify(record)])
}

export async function getSource(token: string): Promise<SourceRecord | null> {
  if (registryMode() === 'memory') return memSources.get(token) ?? null
  return parseRecord<SourceRecord>(await redis(['GET', sourceKey(token)]), sourceKey(token))
}

export async function getPlant(plantId: string): Promise<PlantRecord | null> {
  if (registryMode() === 'memory') return memPlants.get(plantId) ?? null
  return parseRecord<PlantRecord>(await redis(['GET', plantKey(plantId)]), plantKey(plantId))
}

async function slugOwner(slug: string): Promise<string | null> {
  if (registryMode() === 'memory') return memSlugs.get(slug) ?? null
  const raw = await redis(['GET', slugKey(slug)])
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'string') throw new Error(`registry ${slugKey(slug)} holds a non-string value`)
  return raw
}

/**
 * Create or update a plant. A slug, when given, is claimed with it — and an
 * existing slug pointing at a DIFFERENT plant is refused: public names are not
 * stolen by a later mint.
 */
export async function upsertPlant(plantId: string, record: PlantRecord, slug?: string): Promise<void> {
  const mode = registryMode()
  if (slug !== undefined) {
    const owner = await slugOwner(slug)
    if (owner !== null && owner !== plantId) {
      throw new SlugTakenError(`slug "${slug}" already names plant ${owner} — refusing to steal it`)
    }
  }
  if (mode === 'memory') {
    memPlants.set(plantId, record)
    if (slug !== undefined) memSlugs.set(slug, plantId)
    return
  }
  await redis(['SET', plantKey(plantId), JSON.stringify(record)])
  if (slug !== undefined) await redis(['SET', slugKey(slug), plantId])
}

/** Resolve a public slug to its plant. A dangling slug is corruption, not a 404. */
export async function getPlantBySlug(
  slug: string,
): Promise<{ plantId: string; plant: PlantRecord } | null> {
  const plantId = await slugOwner(slug)
  if (plantId === null) return null
  const plant = await getPlant(plantId)
  if (plant === null) {
    throw new Error(`registry ${slugKey(slug)} points at missing plant ${plantId} — refusing to shrug`)
  }
  return { plantId, plant }
}

/**
 * The retention decision, in one exported place so tests can pin the branch:
 * an unregistered token is a demo and evaporates after TTL_SECONDS; a
 * registered source is a real plant and never does. The KV path is the only
 * one with a TTL to skip, but the decision itself is backend-independent and
 * testable without Redis.
 */
export async function shouldExpire(sourceToken: string): Promise<boolean> {
  return (await getSource(sourceToken)) === null
}
