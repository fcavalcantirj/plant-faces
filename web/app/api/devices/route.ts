// POST /api/devices — the admin mint, the one place source tokens are born.
//
// Guarded by PLANTFACES_ADMIN_KEY as a bearer token. A deploy WITHOUT the key
// does not degrade into an open mint — it refuses outright with 503, the same
// honesty rule as storeMode(): misconfiguration must say so, not behave. A
// present-but-wrong key is a plain 401 with nothing leaked about why.

import { NextResponse } from 'next/server'
import { mintDevice, parseMintBody } from '@/lib/devices'
import { SlugTakenError } from '@/lib/store'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const adminKey = process.env.PLANTFACES_ADMIN_KEY
  if (!adminKey) {
    return NextResponse.json(
      { error: 'minting unconfigured: PLANTFACES_ADMIN_KEY is not set on this deployment' },
      { status: 503 },
    )
  }
  if (req.headers.get('authorization') !== `Bearer ${adminKey}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'body is not valid JSON' }, { status: 400 })
  }

  const parsed = parseMintBody(raw)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    const { sourceToken, plantId } = await mintDevice(parsed.body, Date.now())
    return NextResponse.json({ ok: true, source_token: sourceToken, plant_id: plantId })
  } catch (e) {
    if (e instanceof SlugTakenError) {
      return NextResponse.json({ error: (e as Error).message }, { status: 409 })
    }
    // A store that is down must say so, not swallow the mint and pretend.
    return NextResponse.json({ error: `store unavailable: ${(e as Error).message}` }, { status: 503 })
  }
}
