// POST /api/ingest — the one door readings come through.
//
// The simulator posts here today; an ESP32 reading a THCPH-S over RS485 posts
// here tomorrow, byte-identical. Nothing else may write a reading.

import { NextResponse } from 'next/server'
import { parseIngest } from '@/lib/ingest'
import { append } from '@/lib/store'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'body is not valid JSON' }, { status: 400 })
  }

  const parsed = parseIngest(raw, Date.now())
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  try {
    const count = await append(parsed.deviceToken, parsed.reading)
    return NextResponse.json({ ok: true, stored: count, ts: parsed.reading.ts }, { status: 202 })
  } catch (e) {
    // A store that is down must say so, not swallow the reading and 202.
    return NextResponse.json({ error: `store unavailable: ${(e as Error).message}` }, { status: 503 })
  }
}
