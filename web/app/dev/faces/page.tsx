'use client'

// Dev-only face viewer: renders the bare AgentFace for one emotion, chosen via
// ?emotion=<name>. Unlinked from every nav — exists so scripts/shoot-emotions.mjs
// can screenshot all 12 states without driving the simulator. Harmless to ship.

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { AgentFace } from '@/components/agent-face'
import { EMOTIONS, type Emotion } from '@/lib/face-points'

function FaceViewer() {
  const params = useSearchParams()
  const q = params.get('emotion') ?? 'neutral'
  const emotion: Emotion = (EMOTIONS as string[]).includes(q) ? (q as Emotion) : 'neutral'
  return (
    <div style={{ position: 'fixed', inset: 0 }} data-emotion={emotion}>
      <AgentFace emotion={emotion} />
    </div>
  )
}

export default function DevFacesPage() {
  return (
    <Suspense fallback={null}>
      <FaceViewer />
    </Suspense>
  )
}
