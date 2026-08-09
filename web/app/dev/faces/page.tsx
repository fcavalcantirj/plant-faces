'use client'

// Dev-only face viewer: renders the bare AgentFace for one emotion, chosen via
// ?emotion=<name>. Unlinked from every nav — exists so scripts/shoot-emotions.mjs
// can screenshot all 12 states without driving the simulator. Harmless to ship.
//
// ?variant=s1..s3 renders a spike-crown preset (neutral emotion) for the
// crown sweep — scripts/shoot-variants.mjs drives it. Without ?variant the
// default (s1) style is used and ?emotion= works as before.

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { AgentFace } from '@/components/agent-face'
import { DEFAULT_STYLE, EMOTIONS, FACE_PRESETS, setFaceStyle, type Emotion } from '@/lib/face-points'

function FaceViewer() {
  const params = useSearchParams()
  const v = params.get('variant')
  const variant = v && FACE_PRESETS[v] ? v : null
  // setFaceStyle is idempotent per style id, so calling during render is safe;
  // it must run before AgentFace mounts and builds its first targets.
  if (variant) {
    setFaceStyle(FACE_PRESETS[variant].crown, FACE_PRESETS[variant].eye)
  } else {
    setFaceStyle(DEFAULT_STYLE.crown, DEFAULT_STYLE.eye)
  }
  const q = params.get('emotion') ?? 'neutral'
  const emotion: Emotion = variant
    ? 'neutral'
    : (EMOTIONS as string[]).includes(q)
      ? (q as Emotion)
      : 'neutral'
  return (
    <div style={{ position: 'fixed', inset: 0 }} data-emotion={emotion} data-variant={variant ?? 'default'}>
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
