// /p/[slug] — the live plant page. One URL, two doors:
//
//   /p/pimenta?device_token=src_…   the keeper's view — polls /api/readings
//                                   (?latest=1&stats=1) with the token
//   /p/pimenta                      the shareable view — polls the seven
//                                   whitelisted fields of /api/public/[slug]
//
// The token in the query string IS the authorization, same as at the ingest
// door: whoever holds it may read the full compact payload, and the slug is
// only the page's name. No token means the public projection or the one 404 —
// and the 404 is decided HERE, server-side, so a curl of a private plant's
// URL carries the not-found state in its HTML instead of a loading shell that
// answers differently later. Unknown, private and never-posted all render the
// identical dead end; which one it was stays behind the door.
//
// This page renders verdicts; it never computes them. Both modes are
// read-only by construction — no button on either can raise a wellbeing.

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { publicPage } from '@/lib/derive'
import { OwnerPlant, PublicPlant } from '@/components/live-plant'
import type { PublicProjection } from '@/lib/derive'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  // The slug is already in the address bar; naming the tab after it leaks
  // nothing the URL did not.
  return { title: `${slug} · Plant Faces` }
}

export default async function Page({ params, searchParams }: Props) {
  const { slug } = await params
  const sp = await searchParams
  const raw = sp.device_token
  const deviceToken = typeof raw === 'string' && raw.length > 0 ? raw : null

  // Owner mode never touches the registry here: the readings API is the
  // token's judge, and this page just hands the token over.
  if (deviceToken !== null) return <OwnerPlant slug={slug} deviceToken={deviceToken} />

  // Public mode resolves at render time so the first paint is the plant's
  // real face — and so the 404 is a real 404, not a client-side afterthought.
  let initial: PublicProjection | null = null
  let found = true
  try {
    const page = await publicPage(slug, Date.now())
    if (page.status === 200) initial = page.body
    else found = false
  } catch {
    // The store could not answer. That is "later", not "gone" — render the
    // waking state and let the client's poll keep asking. The catch must not
    // swallow notFound(), which is why the refusal happens outside it.
  }
  if (!found) notFound()

  return <PublicPlant slug={slug} initial={initial} />
}
