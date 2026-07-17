// POST /api/derive — the demo's read path.
//
// Why this exists alongside /api/ingest:
//
// A real probe posts once every 15 minutes and its history is worth keeping, so
// it goes through /api/ingest into durable storage. The SIMULATOR is not a
// probe: its whole job is to lie about time, compressing a fortnight into a
// minute. That makes it ~2,700x the event rate of the thing it imitates, and
// every per-event cost — quota, money, rate limits — multiplies by that factor.
// A time-compressed simulator must never sit behind a per-event meter.
//
// So the demo keeps its own readings in the browser (it IS the device) and asks
// the server to score them. The server still does ALL the arithmetic: the client
// cannot compute a wellbeing, so it cannot talk the plant into being happy.
// Nothing is stored, nothing is billed, and two visitors cannot collide.

import { NextResponse } from 'next/server'
import { parseIngest } from '@/lib/ingest'
import {
  deriveSeries,
  initialState,
  plantMood,
  stepState,
  type SensorReading,
} from '@/lib/plant-mood'
import { speciesById } from '@/lib/species'

export const dynamic = 'force-dynamic'

/** A fortnight at the node's cadence is ~1,344 readings. Refuse a firehose. */
const MAX_READINGS = 2000

export async function POST(req: Request) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'body is not valid JSON' }, { status: 400 })
  }

  const body = raw as { species?: unknown; readings?: unknown }
  const profile = speciesById(typeof body.species === 'string' ? body.species : '')

  if (!Array.isArray(body.readings)) {
    return NextResponse.json({ error: 'readings must be an array' }, { status: 400 })
  }
  if (body.readings.length > MAX_READINGS) {
    return NextResponse.json(
      { error: `too many readings: ${body.readings.length} > ${MAX_READINGS}` },
      { status: 413 },
    )
  }
  if (body.readings.length === 0) {
    return NextResponse.json({ paired: false, series: [], latest: null, mood: null })
  }

  // Same gate as the real door: the demo's readings are validated exactly like a
  // probe's, so the simulator cannot feed the engine anything a probe could not.
  const now = Date.now()
  const rows: SensorReading[] = []
  for (const r of body.readings) {
    const parsed = parseIngest(r, now)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    rows.push(parsed.reading)
  }
  rows.sort((a, b) => a.ts - b.ts)

  const series = deriveSeries(rows, profile)
  const latest = rows[rows.length - 1]

  let state = initialState(rows[0], 62)
  for (const r of rows) state = stepState(state, r, profile)

  // The simulator posts a compressed past, so judge it as of its own last
  // reading. See the note on ?replay=1 in /api/readings: a real node is judged
  // against the wall clock, which is what makes a silent probe go dark.
  const mood = plantMood(latest, state, profile, latest.ts)

  return NextResponse.json({
    paired: true,
    profile: profile.id,
    latest,
    mood,
    series,
    count: rows.length,
  })
}
