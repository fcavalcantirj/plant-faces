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
/** Demo pots are not archives. Let an idle one evaporate. */
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

export async function append(deviceToken: string, reading: SensorReading): Promise<number> {
  const mode = storeMode()
  if (mode === 'misconfigured') {
    throw new Error(
      'no durable store: deployed without KV_REST_API_URL/KV_REST_API_TOKEN. ' +
        'Serverless instances share no memory, so readings would vanish at random.',
    )
  }
  if (mode === 'memory') return memAppend(deviceToken, reading)

  const k = key(deviceToken)
  // Idempotent on timestamp: drop any existing member at this score first, so a
  // node retrying a POST cannot double-plot itself.
  await redis(['ZREMRANGEBYSCORE', k, reading.ts, reading.ts])
  await redis(['ZADD', k, reading.ts, JSON.stringify(reading)])
  // Trim oldest-first and refresh the idle clock.
  await redis(['ZREMRANGEBYRANK', k, 0, -(MAX_READINGS + 1)])
  await redis(['EXPIRE', k, TTL_SECONDS])
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
