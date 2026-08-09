'use client'

import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import {
  buildTargets,
  EMOTION_META,
  EYE_X,
  EYE_Y,
  MOUTH_Y,
  RANGES,
  SPROUT_BASE_Y,
  SPROUT_SPAN,
  TOTAL,
  type Emotion,
} from '@/lib/face-points'

// Soft round particle sprite generated in-memory
function makeSprite(): THREE.Texture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.4, 'rgba(255,255,255,0.9)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  return tex
}

function ParticleFace({ emotion }: { emotion: Emotion }) {
  const pointsRef = useRef<THREE.Points>(null)
  // v9 solidity: the fine main pass carries texture grain only — fat
  // under-layer passes carry the MASS (note three.js sizeAttenuation renders
  // points ~2.6x smaller than their world size suggests at fov 42, so the
  // mass sizes look big on paper). crownRef re-draws the sprout range,
  // headRef the face shell, featRef the eyes/mouth/brows — fusing the dense
  // point clouds into solid material instead of ghost-dust.
  const crownRef = useRef<THREE.Points>(null)
  const headRef = useRef<THREE.Points>(null)
  const featRef = useRef<THREE.Points>(null)
  const groupRef = useRef<THREE.Group>(null)

  const sprite = useMemo(() => makeSprite(), [])

  // Mutable simulation state
  const sim = useMemo(() => {
    const initial = buildTargets('neutral')

    // Start scattered so the face ASSEMBLES out of dust on first paint instead
    // of snapping into existence. The per-frame lerp toward the targets already
    // does the work — it just needed somewhere to travel from. Costs nothing:
    // no spinner, no extra state, and it reads as the plant waking up.
    const scattered = Float32Array.from(initial.positions)
    for (let i = 0; i < TOTAL; i++) {
      const idx = i * 3
      const u = Math.random() * 2 - 1
      const theta = Math.random() * Math.PI * 2
      const s = Math.sqrt(1 - u * u)
      const r = 4.5 + Math.random() * 3.5
      scattered[idx] = s * Math.cos(theta) * r
      scattered[idx + 1] = u * r
      scattered[idx + 2] = s * Math.sin(theta) * r - 1
    }

    return {
      current: scattered,
      currentColors: Float32Array.from(initial.colors),
      targetPos: initial.positions,
      targetCol: initial.colors,
      display: new Float32Array(TOTAL * 3),
      phase: Float32Array.from({ length: TOTAL }, () => Math.random() * Math.PI * 2),
      speed: Float32Array.from({ length: TOTAL }, () => 0.6 + Math.random() * 1.2),
      nextBlink: 2.5,
      blinkT: -1,
    }
  }, [])

  const emotionRef = useRef<Emotion>(emotion)
  useEffect(() => {
    emotionRef.current = emotion
    const t = buildTargets(emotion)
    sim.targetPos = t.positions
    sim.targetCol = t.colors
  }, [emotion, sim])

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    const em = emotionRef.current
    const k = Math.min(delta * 3.2, 1)
    const { current, currentColors, targetPos, targetCol, display, phase, speed } = sim

    // blink scheduling (skip when eyes aren't open circles: crescents, lids, hearts, X's)
    const noBlink = em === 'happy' || em === 'sleepy' || em === 'love' || em === 'glitch'
    if (sim.blinkT < 0 && t > sim.nextBlink && !noBlink) {
      sim.blinkT = t
      sim.nextBlink = t + 2.5 + Math.random() * 3
    }
    let blink = 1
    if (sim.blinkT >= 0) {
      const bt = (t - sim.blinkT) / 0.22
      if (bt >= 1) sim.blinkT = -1
      else blink = 0.12 + 0.88 * Math.abs(1 - bt * 2) // 1 -> 0.12 -> 1
    }

    const mouthPulse = em === 'speaking' ? 1 + 0.4 * Math.sin(t * 11) * Math.abs(Math.sin(t * 3.7)) : 1

    // glitch: constant static + occasional horizontal scanline tear bursts
    const glitchAmp = em === 'glitch' ? (Math.sin(t * 23) > 0.88 ? 0.3 : 0.03) : 0

    const [lE0, lE1] = RANGES.leftEye
    const [rE0, rE1] = RANGES.rightEye
    const [m0, m1] = RANGES.mouth
    const [sp0] = RANGES.sprout

    for (let i = 0; i < TOTAL; i++) {
      const idx = i * 3
      // morph toward target
      current[idx] += (targetPos[idx] - current[idx]) * k
      current[idx + 1] += (targetPos[idx + 1] - current[idx + 1]) * k
      current[idx + 2] += (targetPos[idx + 2] - current[idx + 2]) * k
      // color lerp
      currentColors[idx] += (targetCol[idx] - currentColors[idx]) * k
      currentColors[idx + 1] += (targetCol[idx + 1] - currentColors[idx + 1]) * k
      currentColors[idx + 2] += (targetCol[idx + 2] - currentColors[idx + 2]) * k

      // organic wobble
      const w = Math.sin(t * speed[i] + phase[i]) * 0.016
      let x = current[idx] + w
      let y = current[idx + 1] + Math.cos(t * speed[i] * 0.8 + phase[i]) * 0.016
      const z = current[idx + 2] + w * 0.6

      // blink: compress eye particles toward the eye centerline
      if (blink < 1) {
        if (i >= lE0 && i < lE1) y = EYE_Y + (y - EYE_Y) * blink
        else if (i >= rE0 && i < rE1) y = EYE_Y + (y - EYE_Y) * blink
      }
      // speaking: mouth opens/closes rhythmically
      if (mouthPulse !== 1 && i >= m0 && i < m1) {
        y = MOUTH_Y + (y - MOUTH_Y) * mouthPulse
        x = x * (1 + (mouthPulse - 1) * 0.15)
      }
      // spike crown: gentle independent sway — a slow breeze over the
      // spikes, tips travel further than the roots (per-emotion wilt is
      // baked into the targets, so the morph lerp already animates the sag)
      if (i >= sp0) {
        const sw = Math.min(Math.max((current[idx + 1] - SPROUT_BASE_Y) / SPROUT_SPAN, 0), 1)
        x += Math.sin(t * 0.8 + phase[i] * 0.3) * 0.05 * sw
      }
      // glitch: static jitter, stronger on horizontal scanline bands
      if (glitchAmp > 0) {
        const band = Math.sin(y * 14 + t * 40) > 0.55 ? 1 : 0.25
        x += (Math.random() - 0.5) * glitchAmp * band
        y += (Math.random() - 0.5) * glitchAmp * 0.15
      }

      display[idx] = x
      display[idx + 1] = y
      display[idx + 2] = z
    }

    const geo = pointsRef.current?.geometry
    if (geo) {
      ;(geo.attributes.position as THREE.BufferAttribute).copyArray(display)
      geo.attributes.position.needsUpdate = true
      ;(geo.attributes.color as THREE.BufferAttribute).copyArray(currentColors)
      geo.attributes.color.needsUpdate = true
    }
    // crown mass pass mirrors the sprout slice of the same simulation
    const cgeo = crownRef.current?.geometry
    if (cgeo) {
      ;(cgeo.attributes.position as THREE.BufferAttribute).copyArray(display.subarray(sp0 * 3))
      cgeo.attributes.position.needsUpdate = true
      ;(cgeo.attributes.color as THREE.BufferAttribute).copyArray(currentColors.subarray(sp0 * 3))
      cgeo.attributes.color.needsUpdate = true
    }
    // face mass pass mirrors the head-shell slice
    const hEnd = RANGES.head[1]
    const hgeo = headRef.current?.geometry
    if (hgeo) {
      ;(hgeo.attributes.position as THREE.BufferAttribute).copyArray(display.subarray(0, hEnd * 3))
      hgeo.attributes.position.needsUpdate = true
      ;(hgeo.attributes.color as THREE.BufferAttribute).copyArray(currentColors.subarray(0, hEnd * 3))
      hgeo.attributes.color.needsUpdate = true
    }
    // features mass pass mirrors the eyes/mouth/brows slice
    const fEnd = RANGES.rightBrow[1]
    const fgeo = featRef.current?.geometry
    if (fgeo) {
      ;(fgeo.attributes.position as THREE.BufferAttribute).copyArray(display.subarray(hEnd * 3, fEnd * 3))
      fgeo.attributes.position.needsUpdate = true
      ;(fgeo.attributes.color as THREE.BufferAttribute).copyArray(currentColors.subarray(hEnd * 3, fEnd * 3))
      fgeo.attributes.color.needsUpdate = true
    }

    // idle drift + emotion head tilt
    const g = groupRef.current
    if (g) {
      const rot = EMOTION_META[em].rotation
      const driftX = Math.sin(t * 0.4) * 0.03
      const driftY = Math.sin(t * 0.27) * 0.06
      g.rotation.x += (rot[0] + driftX - g.rotation.x) * k * 0.6
      g.rotation.y += (rot[1] + driftY - g.rotation.y) * k * 0.6
      g.rotation.z += (rot[2] - g.rotation.z) * k * 0.6
      // breathing (love = double-thump heartbeat, sleepy = slow deep breaths)
      let breathe = 1 + Math.sin(t * 0.9) * 0.008
      if (em === 'love') {
        const beat = t * 1.4 % 1
        breathe = 1 + (Math.max(0, Math.sin(beat * Math.PI * 2)) * 0.7 + Math.max(0, Math.sin((beat - 0.18) * Math.PI * 2)) * 0.3) * 0.025
      } else if (em === 'sleepy') {
        breathe = 1 + Math.sin(t * 0.45) * 0.018
      }
      g.scale.setScalar(breathe)
    }
  })

  return (
    <group ref={groupRef}>
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[Float32Array.from(sim.current), 3]} />
          <bufferAttribute attach="attributes-color" args={[Float32Array.from(sim.currentColors), 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.03}
          map={sprite}
          vertexColors
          transparent
          opacity={0.65}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          sizeAttenuation
        />
      </points>
      <points ref={crownRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[Float32Array.from(sim.current.subarray(RANGES.sprout[0] * 3)), 3]}
          />
          <bufferAttribute
            attach="attributes-color"
            args={[Float32Array.from(sim.currentColors.subarray(RANGES.sprout[0] * 3)), 3]}
          />
        </bufferGeometry>
        <pointsMaterial
          size={0.085}
          map={sprite}
          vertexColors
          transparent
          opacity={0.25}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          sizeAttenuation
        />
      </points>
      <points ref={headRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[Float32Array.from(sim.current.subarray(0, RANGES.head[1] * 3)), 3]}
          />
          <bufferAttribute
            attach="attributes-color"
            args={[Float32Array.from(sim.currentColors.subarray(0, RANGES.head[1] * 3)), 3]}
          />
        </bufferGeometry>
        <pointsMaterial
          size={0.15}
          map={sprite}
          vertexColors
          transparent
          opacity={0.24}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          sizeAttenuation
        />
      </points>
      <points ref={featRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[Float32Array.from(sim.current.subarray(RANGES.head[1] * 3, RANGES.rightBrow[1] * 3)), 3]}
          />
          <bufferAttribute
            attach="attributes-color"
            args={[Float32Array.from(sim.currentColors.subarray(RANGES.head[1] * 3, RANGES.rightBrow[1] * 3)), 3]}
          />
        </bufferGeometry>
        <pointsMaterial
          size={0.07}
          map={sprite}
          vertexColors
          transparent
          opacity={0.35}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          sizeAttenuation
        />
      </points>
    </group>
  )
}

// Ambient dust field for depth
function Dust() {
  const ref = useRef<THREE.Points>(null)
  const positions = useMemo(() => {
    const n = 400
    const arr = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 14
      arr[i * 3 + 1] = (Math.random() - 0.5) * 9
      arr[i * 3 + 2] = -1.5 - Math.random() * 6
    }
    return arr
  }, [])

  useFrame((state) => {
    if (ref.current) ref.current.rotation.y = state.clock.elapsedTime * 0.012
  })

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.03}
        color="#2a5a34"
        transparent
        opacity={0.7}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        sizeAttenuation
      />
    </points>
  )
}

export function AgentFace({ emotion }: { emotion: Emotion }) {
  return (
    <Canvas
      camera={{ position: [0, 0.42, 7.1], fov: 42 }}
      gl={{ antialias: true, alpha: false }}
      dpr={[1, 2]}
    >
      <color attach="background" args={['#070a10']} />
      <fog attach="fog" args={['#070a10', 6.9, 12.9]} />
      <ParticleFace emotion={emotion} />
      <Dust />
      <OrbitControls
        // orbit target rides above the origin so the crown gets headroom —
        // OrbitControls re-aims the camera at its target, so raising the
        // camera alone buys nothing (the v2 lesson). 0.42 + camera z 7.1
        // frames the tallest spike preset (s3 tips reach y ~2.55; content
        // spans -1.75..2.55, centered at 0.4).
        target={[0, 0.42, 0]}
        enablePan={false}
        enableZoom={false}
        minPolarAngle={Math.PI * 0.35}
        maxPolarAngle={Math.PI * 0.65}
        minAzimuthAngle={-Math.PI * 0.25}
        maxAzimuthAngle={Math.PI * 0.25}
        rotateSpeed={0.5}
      />
    </Canvas>
  )
}
