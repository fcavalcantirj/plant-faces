// /api/devices — the admin door: POST mints source tokens, PATCH publishes.
//
// Both verbs share one gate, PLANTFACES_ADMIN_KEY as a bearer token. A deploy
// WITHOUT the key does not degrade into an open admin door — it refuses
// outright with 503, the same honesty rule as storeMode(): misconfiguration
// must say so, not behave. A present-but-wrong key is a plain 401 with
// nothing leaked about why.
//
// POST is the one place source tokens are born; PATCH is the separate,
// deliberate act of flipping a plant's `public` bit — the only thing that
// makes /api/public/[slug] answer with more than its 404.

import { NextResponse } from 'next/server'
import { applyPublicFlip, mintDevice, parseMintBody, parsePatchBody } from '@/lib/devices'
import { SlugTakenError } from '@/lib/store'

export const dynamic = 'force-dynamic'

/** The shared gate: null means "come in", anything else is the refusal. */
function adminGate(req: Request): NextResponse | null {
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
  return null
}

export async function POST(req: Request) {
  const refusal = adminGate(req)
  if (refusal) return refusal

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

export async function PATCH(req: Request) {
  const refusal = adminGate(req)
  if (refusal) return refusal

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'body is not valid JSON' }, { status: 400 })
  }

  const parsed = parsePatchBody(raw)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    const plant = await applyPublicFlip(parsed.body)
    // A flip must never upsert a plant into existence — an unknown id is a
    // 404, and naming it back is fine on an authenticated admin surface.
    if (plant === null) {
      return NextResponse.json(
        { error: `no plant registered as ${parsed.body.plant_id}` },
        { status: 404 },
      )
    }
    return NextResponse.json({ ok: true, plant_id: parsed.body.plant_id, public: plant.public })
  } catch (e) {
    // A store that is down must say so, not swallow the flip and pretend.
    return NextResponse.json({ error: `store unavailable: ${(e as Error).message}` }, { status: 503 })
  }
}
