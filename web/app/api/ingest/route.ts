// POST /api/ingest — the one door readings come through.
//
// Two wire shapes, one gate: the legacy 4-field soil body (the simulator
// today, an ESP32 reading a THCPH-S over RS485 tomorrow) and envelope v1 (any
// source posting registry channels — see lib/channels.ts). Legacy bodies
// behave byte-identically to before. After validation the reading fans out:
// the Neon archive first when configured (lib/archive.ts — authoritative, so
// its failure refuses the whole ingest), then the KV mood window. Envelopes
// carrying the four soil channels feed the KV window; envelopes without them
// (an air sensor, say) are archive material only, and `stored: 0` says so out
// loud. Nothing else may write a reading.
//
// A stored soil reading's 202 carries the verdict it produced — emotion,
// wellbeing, headline — computed by the same replay /api/readings serves
// (lib/derive.ts), so a node can render a hardware face from the response
// alone. Air-only posts get no verdict fields: no reading, no mood.

import { NextResponse } from 'next/server'
import { archiveIfEnabled } from '@/lib/archive'
import { deriveVerdict, profileForSource } from '@/lib/derive'
import { parseAnyIngest, soilReadingOf } from '@/lib/ingest'
import { append, readings } from '@/lib/store'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  // The body is read as TEXT so the archive keeps it verbatim — the raw
  // column is an audit trail, and an audit trail of re-serialized JSON is a
  // paraphrase.
  let rawBody: string
  let raw: unknown
  try {
    rawBody = await req.text()
    raw = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'body is not valid JSON' }, { status: 400 })
  }

  const parsed = parseAnyIngest(raw, Date.now())
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  // Archive FIRST. When ARCHIVE_DATABASE_URL is set the archive is the
  // authoritative store: a reading it refused is refused outright, even
  // though KV would have taken it — the 24h demo window is not a place a
  // reading can safely land alone. Env unset → archived stays false and this
  // block touches nothing.
  let archived: boolean
  try {
    archived = (await archiveIfEnabled(parsed, rawBody)).archived
  } catch (e) {
    return NextResponse.json(
      { error: `archive unavailable: ${(e as Error).message}` },
      { status: 503 },
    )
  }

  // Legacy bodies store parseIngest's own reading verbatim; envelopes with all
  // four soil channels synthesize the same shape. Either way the mood pipeline
  // is fed identically through one door.
  const reading = parsed.legacyReading ?? soilReadingOf(parsed)
  if (!reading) {
    return NextResponse.json({ ok: true, stored: 0, ts: parsed.ts, archived }, { status: 202 })
  }

  try {
    const count = await append(parsed.sourceToken, reading)
    // The 202 answers with the verdict this reading just caused: replay the
    // stored rows through the same deriveVerdict the readings route serves,
    // so the node hears exactly what the HUD will show a second later. A
    // registered source is judged as its plant's species; an unregistered
    // (demo/legacy) token as the default profile.
    const rows = await readings(parsed.sourceToken)
    const verdict = deriveVerdict(rows, await profileForSource(parsed.sourceToken), Date.now())
    return NextResponse.json(
      {
        ok: true,
        stored: count,
        ts: reading.ts,
        archived,
        emotion: verdict.emotion,
        wellbeing: verdict.wellbeing,
        headline: verdict.headline,
      },
      { status: 202 },
    )
  } catch (e) {
    // A store that is down must say so, not swallow the reading and 202.
    return NextResponse.json({ error: `store unavailable: ${(e as Error).message}` }, { status: 503 })
  }
}
