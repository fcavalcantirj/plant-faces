// GET /api/readings?device_token=…&species=…
//
// The web is a relay: it reads what the soil said and shows it. The SERVER
// derives the wellbeing curve by replaying the stored readings through the same
// pure functions the tests pin; the client only renders. No client-side scoring,
// so a browser can never talk the plant into being happy.

import { NextResponse } from 'next/server'
import { deriveSeries, plantMood, initialState, stepState } from '@/lib/plant-mood'
import { readings } from '@/lib/store'
import { speciesById } from '@/lib/species'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const token = url.searchParams.get('device_token')
  if (!token) return NextResponse.json({ error: 'device_token required' }, { status: 400 })

  const profile = speciesById(url.searchParams.get('species') ?? '')
  const rows = await readings(token)

  if (rows.length === 0) {
    return NextResponse.json({
      paired: false,
      series: [],
      latest: null,
      mood: null,
      profile: profile.id,
    })
  }

  const series = deriveSeries(rows, profile)
  const latest = rows[rows.length - 1]

  // Replay to the current state so the mood matches the curve's last point.
  let state = initialState(rows[0], 62)
  for (const r of rows) state = stepState(state, r, profile)

  // Staleness is judged against the wall clock, which is what makes a silent
  // node show `glitch` instead of a comfortable lie. The simulator is the one
  // caller that must opt out: you cannot fast-forward a plant AND emit
  // wall-clock-fresh timestamps, so a time-lapse is necessarily a replay of the
  // past and every reading in it is "old" by definition. ?replay=1 says "judge
  // this as of its own last reading". A real node never sets it — so a probe
  // that goes quiet still goes dark.
  const replay = url.searchParams.get('replay') === '1'
  const now = replay ? latest.ts : Date.now()
  const mood = plantMood(latest, state, profile, now)

  return NextResponse.json({
    paired: true,
    profile: profile.id,
    latest,
    mood,
    series,
    count: rows.length,
  })
}
