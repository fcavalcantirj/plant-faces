// The app's one dead end — at the ROOT on purpose, not beside /p/[slug].
//
// A notFound() served to a plain HTTP request (curl, first visit, a shared
// link) is answered by re-rendering the dedicated /_not-found route, and that
// route consults ONLY the root not-found file — segment-level boundaries are
// used for client-side navigations alone (next/src/server/app-render:
// createNotFoundLoaderTree). A not-found page that only exists after
// hydration is a loading shell that answers differently later, so the
// boundary lives here, where even curl sees it.
//
// It serves every miss the same way: an unknown URL, an unknown slug, a
// private plant, a public plant that never posted. One body for all of them
// is the same parity /api/public/[slug] keeps — which one it was stays
// behind the door.

import { PlantNotFound } from '@/components/live-plant'

export default function NotFound() {
  return <PlantNotFound />
}
