// GET /api/readings?device_token=…&species=…[&latest=1][&stats=1][&replay=1]
//
// The web is a relay: it reads what the soil said and shows it. The SERVER
// derives the wellbeing curve, the verdict and the inferred care events by
// replaying the stored readings through the same pure functions the tests pin
// (lib/derive.ts — shared with the ingest 202 and the public page); the
// client only renders. No client-side scoring, so a browser can never talk
// the plant into being happy.
//
// ?latest=1 is the polling shape: verdict, latest reading, recent events —
// and no series, because a face checking in every minute must not drag two
// weeks of curve with it.
//
// ?stats=1 attaches the Thales.xlsx-style time-in-band tally (lib/stats.ts)
// to either shape — counted from the same stored rows and judged by the same
// stage bands as the mood, so the face and the ledger can never disagree.

import { NextResponse } from 'next/server'
import { judgementForSource, latestPayload, readingsPayload } from '@/lib/derive'
import { readings } from '@/lib/store'
import { computeStats } from '@/lib/stats'
import { speciesById, withStage } from '@/lib/species'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const token = url.searchParams.get('device_token')
  if (!token) return NextResponse.json({ error: 'device_token required' }, { status: 400 })

  // A registered source is judged as its plant — species AND growth stage from
  // the registry, exactly like the ingest 202. The ?species= knob steers only
  // unregistered demo tokens, which have no registry row to contradict.
  const j = await judgementForSource(token)
  const base = j.registered ? j.profile : speciesById(url.searchParams.get('species') ?? '')
  const profile = withStage(base, j.stage)
  const rows = await readings(token)

  // Staleness is judged against the wall clock, which is what makes a silent
  // node show `glitch` instead of a comfortable lie. The simulator is the one
  // caller that must opt out: you cannot fast-forward a plant AND emit
  // wall-clock-fresh timestamps, so a time-lapse is necessarily a replay of the
  // past and every reading in it is "old" by definition. ?replay=1 says "judge
  // this as of its own last reading". A real node never sets it — so a probe
  // that goes quiet still goes dark.
  const replay = url.searchParams.get('replay') === '1'
  const now = replay && rows.length > 0 ? rows[rows.length - 1].ts : Date.now()

  const payload =
    url.searchParams.get('latest') === '1'
      ? latestPayload(rows, profile, now)
      : readingsPayload(rows, profile, now)
  return NextResponse.json(
    url.searchParams.get('stats') === '1'
      ? { ...payload, stats: computeStats(rows, base, j.stage, now) }
      : payload,
  )
}
