// GET /api/public/[slug] — the shareable plant page, whitelist-only.
//
// Serves exactly seven public fields — label, species, emotion, rounded
// wellbeing, headline, coarse lastSeen bucket, care counts — computed
// server-side by the same verdict replay every other consumer uses
// (lib/derive.ts). Everything else stays behind the door: tokens, sources,
// raw timestamps and the series answer "how is it wired?", and this page only
// answers "how is this plant?". Unknown slug and private plant serve the
// identical 404, so slugs cannot be probed.

import { NextResponse } from 'next/server'
import { publicPage } from '@/lib/derive'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params
  try {
    const page = await publicPage(slug, Date.now())
    return NextResponse.json(page.body, { status: page.status })
  } catch {
    // A registry or store failure must not echo its message onto the one
    // unauthenticated surface — a public page says "later", nothing more.
    return NextResponse.json({ error: 'temporarily unavailable' }, { status: 503 })
  }
}
