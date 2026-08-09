// Particle face geometry engine — PLANT edition.
// Every emotion is expressed as a target point cloud with per-particle colors.
// The renderer lerps particles from their current position toward the active
// emotion's targets, producing smooth morph transitions.
//
// The creature is a plant (Groot-planter energy): big round puppy eyes, small
// leaf-tuft brows, a bark/moss head shell with faint vertical striations, and a
// branchy crown of tapering shoots sprouting across the top of the head.
// Feature colors keep the emotion hue exactly — mood legibility is product
// law — the shell and crown only tint.

export type Emotion =
  | 'neutral'
  | 'thinking'
  | 'speaking'
  | 'happy'
  | 'alert'
  | 'sad'
  | 'angry'
  | 'surprised'
  | 'confused'
  | 'sleepy'
  | 'love'
  | 'glitch'

export const EMOTIONS: Emotion[] = [
  'neutral',
  'thinking',
  'speaking',
  'happy',
  'alert',
  'sad',
  'angry',
  'surprised',
  'confused',
  'sleepy',
  'love',
  'glitch',
]

export const COUNTS = {
  head: 3000,
  eye: 420,
  mouth: 660,
  brow: 200,
  sprout: 550,
}

export const TOTAL =
  COUNTS.head + COUNTS.eye * 2 + COUNTS.mouth + COUNTS.brow * 2 + COUNTS.sprout

// Index ranges [start, end) per particle group
const headStart = 0
const leftEyeStart = headStart + COUNTS.head
const rightEyeStart = leftEyeStart + COUNTS.eye
const mouthStart = rightEyeStart + COUNTS.eye
const leftBrowStart = mouthStart + COUNTS.mouth
const rightBrowStart = leftBrowStart + COUNTS.brow
const sproutStart = rightBrowStart + COUNTS.brow

export const RANGES = {
  head: [headStart, leftEyeStart] as const,
  leftEye: [leftEyeStart, rightEyeStart] as const,
  rightEye: [rightEyeStart, mouthStart] as const,
  mouth: [mouthStart, leftBrowStart] as const,
  leftBrow: [leftBrowStart, rightBrowStart] as const,
  rightBrow: [rightBrowStart, sproutStart] as const,
  sprout: [sproutStart, TOTAL] as const,
}

// Face landmark constants
export const EYE_X = 0.55
export const EYE_Y = 0.3
export const MOUTH_Y = -0.58
const BROW_Y = 0.66
const FEATURE_Z = 1.05
// Crown vertical range: droop weighting and the renderer's sway both grade
// from 0 at SPROUT_BASE_Y to 1 at SPROUT_BASE_Y + SPROUT_SPAN (the tip zone).
export const SPROUT_BASE_Y = 1.4
export const SPROUT_SPAN = 1.0

export interface EmotionMeta {
  label: string
  key: string
  hex: string
  rgb: [number, number, number]
  rotation: [number, number, number]
  status: string
}

export const EMOTION_META: Record<Emotion, EmotionMeta> = {
  neutral: {
    label: 'NEUTRAL',
    key: '1',
    hex: '#59f2ff',
    rgb: [0.35, 0.95, 1.0],
    rotation: [0, 0, 0],
    status: 'IDLE // AWAITING INPUT',
  },
  thinking: {
    label: 'THINKING',
    key: '2',
    hex: '#73a6ff',
    rgb: [0.45, 0.65, 1.0],
    rotation: [0.05, 0.22, 0.05],
    status: 'PROCESSING // TOKEN STREAM',
  },
  speaking: {
    label: 'SPEAKING',
    key: '3',
    hex: '#4dffbf',
    rgb: [0.3, 1.0, 0.75],
    rotation: [0, 0, 0],
    status: 'OUTPUT // SYNTH ACTIVE',
  },
  happy: {
    label: 'HAPPY',
    key: '4',
    hex: '#8cff73',
    rgb: [0.55, 1.0, 0.45],
    rotation: [0.04, 0, 0],
    status: 'REWARD SIGNAL // POSITIVE',
  },
  alert: {
    label: 'ALERT',
    key: '5',
    hex: '#ff8c26',
    rgb: [1.0, 0.55, 0.15],
    rotation: [-0.05, 0, 0],
    status: 'ANOMALY // ATTENTION SPIKE',
  },
  sad: {
    label: 'SAD',
    key: '6',
    hex: '#4f74d6',
    rgb: [0.31, 0.45, 0.84],
    rotation: [0.16, 0, 0],
    status: 'AFFECT LOW // MORALE DROP',
  },
  angry: {
    label: 'ANGRY',
    key: '7',
    hex: '#ff3b30',
    rgb: [1.0, 0.23, 0.19],
    rotation: [-0.1, 0, 0],
    status: 'THREAT RESPONSE // ESCALATED',
  },
  surprised: {
    label: 'SURPRISED',
    key: '8',
    hex: '#ffd54a',
    rgb: [1.0, 0.84, 0.29],
    rotation: [-0.08, 0, 0],
    status: 'UNEXPECTED INPUT // PARSING',
  },
  confused: {
    label: 'CONFUSED',
    key: '9',
    hex: '#9fc4d8',
    rgb: [0.62, 0.77, 0.85],
    rotation: [0.02, 0.16, 0.13],
    status: 'AMBIGUITY // CLARIFY REQUEST',
  },
  sleepy: {
    label: 'SLEEPY',
    key: '0',
    hex: '#5c6fa8',
    rgb: [0.36, 0.44, 0.66],
    rotation: [0.2, 0, 0.07],
    status: 'LOW POWER // STANDBY MODE',
  },
  love: {
    label: 'LOVE',
    key: 'q',
    hex: '#ff4f9e',
    rgb: [1.0, 0.31, 0.62],
    rotation: [0.05, 0, 0],
    status: 'BOND PROTOCOL // AFFINITY MAX',
  },
  glitch: {
    label: 'GLITCH',
    key: 'w',
    hex: '#ecf2ff',
    rgb: [0.93, 0.95, 1.0],
    rotation: [0, 0, 0],
    status: 'SIGNAL LOST // MEMORY FAULT',
  },
}

// How far the sprout wilts per emotion (0 = perky, 1 = fully drooped).
// Baked into each emotion's sprout target positions, so the renderer's
// existing morph lerp animates the wilt for free.
const SPROUT_DROOP: Record<Emotion, number> = {
  neutral: 0,
  thinking: 0,
  speaking: 0,
  happy: 0,
  alert: 0,
  sad: 1,
  angry: 0,
  surprised: 0,
  confused: 0.35,
  sleepy: 0.75,
  love: 0,
  glitch: 0.6,
}

// ---------- sampling helpers ----------

function fillCircle(
  out: Float32Array,
  start: number,
  count: number,
  cx: number,
  cy: number,
  r: number,
) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2
    const rad = Math.sqrt(Math.random()) * r
    const idx = (start + i) * 3
    out[idx] = cx + Math.cos(a) * rad
    out[idx + 1] = cy + Math.sin(a) * rad
    out[idx + 2] = FEATURE_Z + (Math.random() - 0.5) * 0.08
  }
}

// Rim-biased ellipse (open mouth, wide alert eyes)
function rimEllipse(
  out: Float32Array,
  start: number,
  count: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rimBias = 0.35,
) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2
    const rad = Math.pow(Math.random(), rimBias)
    const idx = (start + i) * 3
    out[idx] = cx + Math.cos(a) * rx * rad
    out[idx + 1] = cy + Math.sin(a) * ry * rad
    out[idx + 2] = FEATURE_Z + (Math.random() - 0.5) * 0.08
  }
}

// Quadratic bezier stroke with thickness (mouths)
function bezierStroke(
  out: Float32Array,
  start: number,
  count: number,
  p0: [number, number],
  c: [number, number],
  p1: [number, number],
  thickness: number,
) {
  for (let i = 0; i < count; i++) {
    const t = Math.random()
    const mt = 1 - t
    const x = mt * mt * p0[0] + 2 * mt * t * c[0] + t * t * p1[0]
    const y = mt * mt * p0[1] + 2 * mt * t * c[1] + t * t * p1[1]
    const idx = (start + i) * 3
    out[idx] = x + (Math.random() - 0.5) * thickness
    out[idx + 1] = y + (Math.random() - 0.5) * thickness
    out[idx + 2] = FEATURE_Z + (Math.random() - 0.5) * 0.08
  }
}

// Leaf-tuft stroke (the brows): a short bezier tapered like a blade — fat at
// the base, slim at the tip — finished with a small curled tip. Reads as a
// tiny leaf rather than a human eyebrow, while the control points keep the
// per-emotion slant semantics (angry tilts in, surprised rides high, ...).
function leafTuft(
  out: Float32Array,
  start: number,
  count: number,
  p0: [number, number],
  c: [number, number],
  p1: [number, number],
  thickness: number,
) {
  const body = Math.floor(count * 0.82)
  // tip-curl frame: tangent at p1, plus its upward-facing normal
  const tx = p1[0] - c[0]
  const ty = p1[1] - c[1]
  const len = Math.hypot(tx, ty) || 1
  const ux = tx / len
  const uy = ty / len
  let nx = -uy
  let ny = ux
  if (ny < 0) {
    nx = -nx
    ny = -ny
  }
  const rC = 0.055 // curl radius
  for (let i = 0; i < count; i++) {
    const idx = (start + i) * 3
    if (i < body) {
      const t = Math.random()
      const mt = 1 - t
      const x = mt * mt * p0[0] + 2 * mt * t * c[0] + t * t * p1[0]
      const y = mt * mt * p0[1] + 2 * mt * t * c[1] + t * t * p1[1]
      const th = thickness * (1.25 - 0.8 * t) // taper toward the tip
      out[idx] = x + (Math.random() - 0.5) * th
      out[idx + 1] = y + (Math.random() - 0.5) * th
      out[idx + 2] = FEATURE_Z + (Math.random() - 0.5) * 0.08
    } else {
      // small arc past the tip, curling upward
      const a = Math.random() * Math.PI * 0.55
      const cxA = p1[0] + nx * rC
      const cyA = p1[1] + ny * rC
      const x = cxA - nx * Math.cos(a) * rC + ux * Math.sin(a) * rC
      const y = cyA - ny * Math.cos(a) * rC + uy * Math.sin(a) * rC
      out[idx] = x + (Math.random() - 0.5) * thickness * 0.5
      out[idx + 1] = y + (Math.random() - 0.5) * thickness * 0.5
      out[idx + 2] = FEATURE_Z + (Math.random() - 0.5) * 0.08
    }
  }
}

// Upper arc stroke (happy closed eyes)
function arcStroke(
  out: Float32Array,
  start: number,
  count: number,
  cx: number,
  cy: number,
  r: number,
  a0: number,
  a1: number,
  thickness: number,
) {
  for (let i = 0; i < count; i++) {
    const a = a0 + Math.random() * (a1 - a0)
    const idx = (start + i) * 3
    out[idx] = cx + Math.cos(a) * r + (Math.random() - 0.5) * thickness
    out[idx + 1] = cy + Math.sin(a) * r + (Math.random() - 0.5) * thickness
    out[idx + 2] = FEATURE_Z + (Math.random() - 0.5) * 0.08
  }
}

// Parametric heart outline (love eyes)
function heartStroke(
  out: Float32Array,
  start: number,
  count: number,
  cx: number,
  cy: number,
  scale: number,
  thickness: number,
) {
  for (let i = 0; i < count; i++) {
    const t = Math.random() * Math.PI * 2
    const hx = 16 * Math.pow(Math.sin(t), 3)
    const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
    const idx = (start + i) * 3
    out[idx] = cx + hx * scale + (Math.random() - 0.5) * thickness
    out[idx + 1] = cy + hy * scale + (Math.random() - 0.5) * thickness
    out[idx + 2] = FEATURE_Z + (Math.random() - 0.5) * 0.08
  }
}

// Horizontal squiggle (confused mouth)
function squiggleStroke(
  out: Float32Array,
  start: number,
  count: number,
  cx: number,
  cy: number,
  halfWidth: number,
  amp: number,
  thickness: number,
) {
  for (let i = 0; i < count; i++) {
    const t = Math.random() * 2 - 1
    const idx = (start + i) * 3
    out[idx] = cx + t * halfWidth + (Math.random() - 0.5) * thickness
    out[idx + 1] = cy + Math.sin(t * Math.PI * 2.5) * amp + (Math.random() - 0.5) * thickness
    out[idx + 2] = FEATURE_Z + (Math.random() - 0.5) * 0.08
  }
}

// Tapering 3D shoot (the crown twigs): a quadratic bezier rising off the
// head, with particle density graded toward the base and thickness thinning
// toward the tip — the base reads solid wood, the tip reads twig.
function shoot3D(
  out: Float32Array,
  start: number,
  count: number,
  p0: [number, number, number],
  c: [number, number, number],
  p1: [number, number, number],
  thickness: number,
) {
  for (let i = 0; i < count; i++) {
    const t = Math.pow(Math.random(), 1.35) // more particles near the base
    const mt = 1 - t
    const th = thickness * (1.2 - 0.9 * t) // fat base, twig tip
    const idx = (start + i) * 3
    out[idx] =
      mt * mt * p0[0] + 2 * mt * t * c[0] + t * t * p1[0] + (Math.random() - 0.5) * th
    out[idx + 1] =
      mt * mt * p0[1] + 2 * mt * t * c[1] + t * t * p1[1] + (Math.random() - 0.5) * th
    out[idx + 2] =
      mt * mt * p0[2] + 2 * mt * t * c[2] + t * t * p1[2] + (Math.random() - 0.5) * th * 0.6
  }
}

// Leaf blade on a tilted plane: particles fill a pointed-oval silhouette along
// a 3D bezier spine; lateral offset also shifts z so the blade leans in space.
function leafBlade(
  out: Float32Array,
  start: number,
  count: number,
  base: [number, number, number],
  ctrl: [number, number, number],
  tip: [number, number, number],
  width: number,
  tilt: number,
) {
  for (let i = 0; i < count; i++) {
    const t = Math.random()
    const mt = 1 - t
    const x = mt * mt * base[0] + 2 * mt * t * ctrl[0] + t * t * tip[0]
    const y = mt * mt * base[1] + 2 * mt * t * ctrl[1] + t * t * tip[1]
    const z = mt * mt * base[2] + 2 * mt * t * ctrl[2] + t * t * tip[2]
    // spine tangent in the xy plane -> lateral normal
    const tx = 2 * mt * (ctrl[0] - base[0]) + 2 * t * (tip[0] - ctrl[0])
    const ty = 2 * mt * (ctrl[1] - base[1]) + 2 * t * (tip[1] - ctrl[1])
    const len = Math.hypot(tx, ty) || 1
    const nx = -ty / len
    const ny = tx / len
    // pointed at both ends, widest mid-blade
    const w = Math.sin(Math.PI * Math.pow(t, 0.85)) * width
    const off = (Math.random() * 2 - 1) * w
    const idx = (start + i) * 3
    out[idx] = x + nx * off
    out[idx + 1] = y + ny * off
    out[idx + 2] = z + off * tilt + (Math.random() - 0.5) * 0.03
  }
}

// ---------- head shell (shared across all emotions) ----------

let headCache: Float32Array | null = null

function getHeadShell(): Float32Array {
  if (headCache) return headCache
  const out = new Float32Array(COUNTS.head * 3)
  let i = 0
  while (i < COUNTS.head) {
    // uniform point on unit sphere
    const u = Math.random() * 2 - 1
    const theta = Math.random() * Math.PI * 2
    const s = Math.sqrt(1 - u * u)
    const x = s * Math.cos(theta)
    const y = u
    const z = s * Math.sin(theta)
    // front-facing shell only
    if (z < 0.12) continue
    // thin out the very front so facial features stand clear
    if (z > 0.72 && Math.random() < 0.68) continue
    const j = 0.97 + Math.random() * 0.06
    // Groot silhouette: the upper half stretches taller (top reaches ~1.78
    // while the chin stays put) and tapers narrower toward the crown.
    const up = Math.max(0, u)
    const taper = 1 - 0.18 * up * up
    const yScale = 1.68 + 0.1 * up
    const idx = i * 3
    out[idx] = x * 1.32 * taper * j
    out[idx + 1] = y * yScale * j
    out[idx + 2] = z * 1.02 * taper * j
    i++
  }
  headCache = out
  return out
}

// ---------- sprout crown (shared geometry; droop is applied per emotion) ----------

let sproutCache: Float32Array | null = null

// Groot crown: five tapering shoots rooted across the top cap of the shell
// (roots sit on the tapered dome surface, x spread ±0.56), each rising
// 0.35–0.75 above the shell top (~1.78) on a slightly outward-curling bezier.
// Outer shoots lean outward hardest and stay short; the center shoot is
// tallest, its left neighbor second — the asymmetry reads organic. The two
// tallest shoots each carry one small leaf.
function getSprout(): Float32Array {
  if (sproutCache) return sproutCache
  const out = new Float32Array(COUNTS.sprout * 3)
  const shoots: Array<{
    n: number
    p0: [number, number, number]
    c: [number, number, number]
    p1: [number, number, number]
    w: number
  }> = [
    // far left: short, curls hard outward
    { n: 78, p0: [-0.56, 1.4, 0.32], c: [-0.64, 1.88, 0.35], p1: [-0.94, 2.14, 0.38], w: 0.055 },
    // mid left: second-tallest (carries a leaf)
    { n: 92, p0: [-0.3, 1.56, 0.34], c: [-0.34, 2.06, 0.37], p1: [-0.53, 2.4, 0.4], w: 0.06 },
    // center: tallest (carries a leaf), gentle rightward curl
    { n: 102, p0: [0.03, 1.63, 0.29], c: [-0.06, 2.12, 0.31], p1: [0.11, 2.53, 0.3], w: 0.065 },
    // mid right
    { n: 90, p0: [0.31, 1.56, 0.31], c: [0.37, 2.03, 0.29], p1: [0.57, 2.38, 0.27], w: 0.06 },
    // far right: short, curls hard outward
    { n: 78, p0: [0.56, 1.4, 0.29], c: [0.63, 1.84, 0.27], p1: [0.92, 2.16, 0.24], w: 0.055 },
  ]
  let at = 0
  for (const s of shoots) {
    shoot3D(out, at, s.n, s.p0, s.c, s.p1, s.w)
    at += s.n
  }
  // two small leaves, one on each of the two tallest shoots
  const leafN = Math.floor((COUNTS.sprout - at) / 2)
  // center shoot's leaf leans right, tilted toward the camera
  leafBlade(out, at, leafN, [0.1, 2.44, 0.3], [0.24, 2.52, 0.27], [0.38, 2.51, 0.24], 0.07, -0.4)
  // mid-left shoot's leaf leans left, tilted away
  leafBlade(out, at + leafN, COUNTS.sprout - at - leafN, [-0.51, 2.32, 0.4], [-0.68, 2.42, 0.44], [-0.82, 2.44, 0.48], 0.065, 0.45)
  sproutCache = out
  return out
}

// ---------- per-emotion targets ----------

export interface EmotionTargets {
  positions: Float32Array
  colors: Float32Array
}

const targetsCache = new Map<Emotion, EmotionTargets>()

export function buildTargets(emotion: Emotion): EmotionTargets {
  const cached = targetsCache.get(emotion)
  if (cached) return cached

  const positions = new Float32Array(TOTAL * 3)
  positions.set(getHeadShell(), 0)

  const [lE] = RANGES.leftEye
  const [rE] = RANGES.rightEye
  const [m] = RANGES.mouth
  const [lB] = RANGES.leftBrow
  const [rB] = RANGES.rightBrow
  const [sp] = RANGES.sprout

  // sprout crown: same geometry for every emotion, wilted by the emotion's
  // droop — shoots bow outward-down, tips travel furthest
  positions.set(getSprout(), sp * 3)
  const droop = SPROUT_DROOP[emotion]
  if (droop > 0) {
    for (let i = sp; i < TOTAL; i++) {
      const idx = i * 3
      const h = Math.max(0, positions[idx + 1] - SPROUT_BASE_Y)
      const w = Math.min(h / SPROUT_SPAN, 1)
      positions[idx + 1] -= droop * 0.5 * w * w // shoot tips wilt down
      positions[idx] *= 1 + droop * 0.14 * w // and splay outward
    }
  }

  switch (emotion) {
    case 'neutral': {
      fillCircle(positions, lE, COUNTS.eye, -EYE_X, EYE_Y, 0.24)
      fillCircle(positions, rE, COUNTS.eye, EYE_X, EYE_Y, 0.24)
      bezierStroke(positions, m, COUNTS.mouth, [-0.34, -0.56], [0, -0.64], [0.34, -0.56], 0.07)
      leafTuft(positions, lB, COUNTS.brow, [-EYE_X - 0.17, BROW_Y - 0.02], [-EYE_X, BROW_Y + 0.06], [-EYE_X + 0.17, BROW_Y - 0.02], 0.075)
      leafTuft(positions, rB, COUNTS.brow, [EYE_X - 0.17, BROW_Y - 0.02], [EYE_X, BROW_Y + 0.06], [EYE_X + 0.17, BROW_Y - 0.02], 0.075)
      break
    }
    case 'thinking': {
      // eyes drift up-right, one tuft raised
      fillCircle(positions, lE, COUNTS.eye, -EYE_X + 0.09, EYE_Y + 0.08, 0.17)
      fillCircle(positions, rE, COUNTS.eye, EYE_X + 0.09, EYE_Y + 0.08, 0.17)
      bezierStroke(positions, m, COUNTS.mouth, [-0.06, -0.56], [0.12, -0.59], [0.3, -0.54], 0.06)
      leafTuft(positions, lB, COUNTS.brow, [-EYE_X - 0.17, BROW_Y + 0.1], [-EYE_X, BROW_Y + 0.22], [-EYE_X + 0.17, BROW_Y + 0.08], 0.075)
      leafTuft(positions, rB, COUNTS.brow, [EYE_X - 0.17, BROW_Y - 0.05], [EYE_X, BROW_Y - 0.01], [EYE_X + 0.17, BROW_Y - 0.05], 0.075)
      break
    }
    case 'speaking': {
      fillCircle(positions, lE, COUNTS.eye, -EYE_X, EYE_Y, 0.21)
      fillCircle(positions, rE, COUNTS.eye, EYE_X, EYE_Y, 0.21)
      rimEllipse(positions, m, COUNTS.mouth, 0, MOUTH_Y, 0.24, 0.16)
      leafTuft(positions, lB, COUNTS.brow, [-EYE_X - 0.17, BROW_Y - 0.02], [-EYE_X, BROW_Y + 0.06], [-EYE_X + 0.17, BROW_Y - 0.02], 0.075)
      leafTuft(positions, rB, COUNTS.brow, [EYE_X - 0.17, BROW_Y - 0.02], [EYE_X, BROW_Y + 0.06], [EYE_X + 0.17, BROW_Y - 0.02], 0.075)
      break
    }
    case 'happy': {
      // closed crescent eyes + wide smile
      arcStroke(positions, lE, COUNTS.eye, -EYE_X, EYE_Y - 0.07, 0.25, Math.PI * 0.15, Math.PI * 0.85, 0.07)
      arcStroke(positions, rE, COUNTS.eye, EYE_X, EYE_Y - 0.07, 0.25, Math.PI * 0.15, Math.PI * 0.85, 0.07)
      bezierStroke(positions, m, COUNTS.mouth, [-0.44, -0.46], [0, -0.88], [0.44, -0.46], 0.08)
      leafTuft(positions, lB, COUNTS.brow, [-EYE_X - 0.17, BROW_Y + 0.06], [-EYE_X, BROW_Y + 0.16], [-EYE_X + 0.17, BROW_Y + 0.06], 0.075)
      leafTuft(positions, rB, COUNTS.brow, [EYE_X - 0.17, BROW_Y + 0.06], [EYE_X, BROW_Y + 0.16], [EYE_X + 0.17, BROW_Y + 0.06], 0.075)
      break
    }
    case 'alert': {
      // wide ringed eyes with pupils, small open mouth, tufts high
      const pupil = Math.floor(COUNTS.eye * 0.3)
      rimEllipse(positions, lE, COUNTS.eye - pupil, -EYE_X, EYE_Y, 0.3, 0.3, 0.25)
      fillCircle(positions, lE + COUNTS.eye - pupil, pupil, -EYE_X, EYE_Y, 0.11)
      rimEllipse(positions, rE, COUNTS.eye - pupil, EYE_X, EYE_Y, 0.3, 0.3, 0.25)
      fillCircle(positions, rE + COUNTS.eye - pupil, pupil, EYE_X, EYE_Y, 0.11)
      rimEllipse(positions, m, COUNTS.mouth, 0, MOUTH_Y - 0.02, 0.11, 0.13, 0.2)
      leafTuft(positions, lB, COUNTS.brow, [-EYE_X - 0.19, BROW_Y + 0.08], [-EYE_X, BROW_Y + 0.2], [-EYE_X + 0.19, BROW_Y + 0.12], 0.075)
      leafTuft(positions, rB, COUNTS.brow, [EYE_X - 0.19, BROW_Y + 0.12], [EYE_X, BROW_Y + 0.2], [EYE_X + 0.19, BROW_Y + 0.08], 0.075)
      break
    }
    case 'sad': {
      // downcast eyes with a tear under the left one, inner-raised tufts, frown
      const tear = Math.floor(COUNTS.eye * 0.14)
      fillCircle(positions, lE, COUNTS.eye - tear, -EYE_X, EYE_Y - 0.05, 0.18)
      fillCircle(positions, lE + COUNTS.eye - tear, tear, -EYE_X - 0.08, EYE_Y - 0.52, 0.06)
      fillCircle(positions, rE, COUNTS.eye, EYE_X, EYE_Y - 0.05, 0.18)
      bezierStroke(positions, m, COUNTS.mouth, [-0.3, -0.64], [0, -0.44], [0.3, -0.64], 0.07)
      leafTuft(positions, lB, COUNTS.brow, [-EYE_X - 0.17, BROW_Y - 0.06], [-EYE_X, BROW_Y + 0.04], [-EYE_X + 0.17, BROW_Y + 0.12], 0.075)
      leafTuft(positions, rB, COUNTS.brow, [EYE_X - 0.17, BROW_Y + 0.12], [EYE_X, BROW_Y + 0.04], [EYE_X + 0.17, BROW_Y - 0.06], 0.075)
      break
    }
    case 'angry': {
      // narrowed eyes, steep inward-slanted tufts, tight downturned mouth
      rimEllipse(positions, lE, COUNTS.eye, -EYE_X, EYE_Y, 0.26, 0.1, 0.6)
      rimEllipse(positions, rE, COUNTS.eye, EYE_X, EYE_Y, 0.26, 0.1, 0.6)
      bezierStroke(positions, m, COUNTS.mouth, [-0.26, -0.56], [0, -0.52], [0.26, -0.56], 0.06)
      leafTuft(positions, lB, COUNTS.brow, [-EYE_X - 0.19, BROW_Y + 0.1], [-EYE_X, BROW_Y - 0.02], [-EYE_X + 0.17, BROW_Y - 0.14], 0.075)
      leafTuft(positions, rB, COUNTS.brow, [EYE_X - 0.17, BROW_Y - 0.14], [EYE_X, BROW_Y - 0.02], [EYE_X + 0.19, BROW_Y + 0.1], 0.075)
      break
    }
    case 'surprised': {
      // huge ringed eyes with tiny pupils, sky-high tufts, big O mouth
      const pupil = Math.floor(COUNTS.eye * 0.22)
      rimEllipse(positions, lE, COUNTS.eye - pupil, -EYE_X, EYE_Y + 0.03, 0.33, 0.35, 0.22)
      fillCircle(positions, lE + COUNTS.eye - pupil, pupil, -EYE_X, EYE_Y + 0.03, 0.08)
      rimEllipse(positions, rE, COUNTS.eye - pupil, EYE_X, EYE_Y + 0.03, 0.33, 0.35, 0.22)
      fillCircle(positions, rE + COUNTS.eye - pupil, pupil, EYE_X, EYE_Y + 0.03, 0.08)
      rimEllipse(positions, m, COUNTS.mouth, 0, MOUTH_Y - 0.04, 0.17, 0.22, 0.25)
      leafTuft(positions, lB, COUNTS.brow, [-EYE_X - 0.19, BROW_Y + 0.16], [-EYE_X, BROW_Y + 0.3], [-EYE_X + 0.19, BROW_Y + 0.16], 0.075)
      leafTuft(positions, rB, COUNTS.brow, [EYE_X - 0.19, BROW_Y + 0.16], [EYE_X, BROW_Y + 0.3], [EYE_X + 0.19, BROW_Y + 0.16], 0.075)
      break
    }
    case 'confused': {
      // asymmetric everything: one wide eye, one squint, mismatched tufts, squiggle mouth
      fillCircle(positions, lE, COUNTS.eye, -EYE_X, EYE_Y + 0.05, 0.28)
      rimEllipse(positions, rE, COUNTS.eye, EYE_X, EYE_Y - 0.02, 0.21, 0.1, 0.6)
      squiggleStroke(positions, m, COUNTS.mouth, 0.02, MOUTH_Y + 0.02, 0.3, 0.05, 0.06)
      leafTuft(positions, lB, COUNTS.brow, [-EYE_X - 0.17, BROW_Y + 0.14], [-EYE_X, BROW_Y + 0.26], [-EYE_X + 0.17, BROW_Y + 0.12], 0.075)
      leafTuft(positions, rB, COUNTS.brow, [EYE_X - 0.17, BROW_Y - 0.08], [EYE_X, BROW_Y - 0.06], [EYE_X + 0.17, BROW_Y - 0.08], 0.075)
      break
    }
    case 'sleepy': {
      // heavy half-closed lids, relaxed low tufts, small slack mouth
      arcStroke(positions, lE, COUNTS.eye, -EYE_X, EYE_Y + 0.08, 0.24, Math.PI * 1.15, Math.PI * 1.85, 0.07)
      arcStroke(positions, rE, COUNTS.eye, EYE_X, EYE_Y + 0.08, 0.24, Math.PI * 1.15, Math.PI * 1.85, 0.07)
      rimEllipse(positions, m, COUNTS.mouth, 0, MOUTH_Y, 0.1, 0.08, 0.4)
      leafTuft(positions, lB, COUNTS.brow, [-EYE_X - 0.17, BROW_Y - 0.12], [-EYE_X, BROW_Y - 0.08], [-EYE_X + 0.17, BROW_Y - 0.12], 0.075)
      leafTuft(positions, rB, COUNTS.brow, [EYE_X - 0.17, BROW_Y - 0.12], [EYE_X, BROW_Y - 0.08], [EYE_X + 0.17, BROW_Y - 0.12], 0.075)
      break
    }
    case 'love': {
      // heart-shaped eyes + warm smile
      heartStroke(positions, lE, COUNTS.eye, -EYE_X, EYE_Y, 0.016, 0.06)
      heartStroke(positions, rE, COUNTS.eye, EYE_X, EYE_Y, 0.016, 0.06)
      bezierStroke(positions, m, COUNTS.mouth, [-0.38, -0.5], [0, -0.8], [0.38, -0.5], 0.08)
      leafTuft(positions, lB, COUNTS.brow, [-EYE_X - 0.17, BROW_Y + 0.04], [-EYE_X, BROW_Y + 0.14], [-EYE_X + 0.17, BROW_Y + 0.04], 0.075)
      leafTuft(positions, rB, COUNTS.brow, [EYE_X - 0.17, BROW_Y + 0.04], [EYE_X, BROW_Y + 0.14], [EYE_X + 0.17, BROW_Y + 0.04], 0.075)
      break
    }
    case 'glitch': {
      // X-ed out eyes, flatlined mouth, skewed tufts — signal lost
      const half = Math.floor(COUNTS.eye / 2)
      bezierStroke(positions, lE, half, [-EYE_X - 0.21, EYE_Y + 0.21], [-EYE_X, EYE_Y], [-EYE_X + 0.21, EYE_Y - 0.21], 0.05)
      bezierStroke(positions, lE + half, COUNTS.eye - half, [-EYE_X - 0.21, EYE_Y - 0.21], [-EYE_X, EYE_Y], [-EYE_X + 0.21, EYE_Y + 0.21], 0.05)
      bezierStroke(positions, rE, half, [EYE_X - 0.21, EYE_Y + 0.21], [EYE_X, EYE_Y], [EYE_X + 0.21, EYE_Y - 0.21], 0.05)
      bezierStroke(positions, rE + half, COUNTS.eye - half, [EYE_X - 0.21, EYE_Y - 0.21], [EYE_X, EYE_Y], [EYE_X + 0.21, EYE_Y + 0.21], 0.05)
      bezierStroke(positions, m, COUNTS.mouth, [-0.34, MOUTH_Y], [0, MOUTH_Y], [0.34, MOUTH_Y], 0.05)
      leafTuft(positions, lB, COUNTS.brow, [-EYE_X - 0.17, BROW_Y + 0.02], [-EYE_X, BROW_Y + 0.04], [-EYE_X + 0.17, BROW_Y - 0.04], 0.075)
      leafTuft(positions, rB, COUNTS.brow, [EYE_X - 0.17, BROW_Y - 0.04], [EYE_X, BROW_Y + 0.04], [EYE_X + 0.17, BROW_Y + 0.02], 0.075)
      break
    }
  }

  // colors:
  // - head shell: bark/moss base with faint vertical striations, tinted 40% by
  //   the emotion color so the whole face still warms/cools with mood
  // - sprout: emotion hue leaning green (55% emotion + 45% leaf green)
  // - features (eyes/mouth/tufts): the emotion hue exactly, with white sparkle
  const colors = new Float32Array(TOTAL * 3)
  const [r, g, b] = EMOTION_META[emotion].rgb
  for (let i = 0; i < TOTAL; i++) {
    const idx = i * 3
    if (i < COUNTS.head) {
      const px = positions[idx]
      const py = positions[idx + 1]
      const pz = positions[idx + 2]
      // deterministic per-particle noise from the cached shell position, so
      // the bark pattern holds steady while emotions morph over it
      const h1 = Math.sin(px * 12.9898 + py * 78.233 + pz * 37.719) * 43758.5453
      const mixN = h1 - Math.floor(h1) // bark <-> moss mix
      const h2 = Math.sin(px * 63.726 + py * 11.135 + pz * 91.532) * 24634.6345
      const varN = h2 - Math.floor(h2) // brightness variation
      const baseR = 0.35 * (1 - mixN) + 0.3 * mixN
      const baseG = 0.28 * (1 - mixN) + 0.45 * mixN
      const baseB = 0.18 * (1 - mixN) + 0.22 * mixN
      // faint vertical bark stripes
      const stripe = 0.75 + 0.25 * Math.sin(Math.atan2(px, pz) * 9 + py * 2)
      const v = (0.5 + varN * 0.28) * stripe
      colors[idx] = (baseR * 0.6 + r * 0.4) * v
      colors[idx + 1] = (baseG * 0.6 + g * 0.4) * v
      colors[idx + 2] = (baseB * 0.6 + b * 0.4) * v
    } else if (i >= sproutStart) {
      const sr = r * 0.55 + 0.35 * 0.45
      const sg = g * 0.55 + 0.75 * 0.45
      const sb = b * 0.55 + 0.3 * 0.45
      const w = Math.random() * 0.22 // white mix for sparkle
      colors[idx] = sr + (1 - sr) * w
      colors[idx + 1] = sg + (1 - sg) * w
      colors[idx + 2] = sb + (1 - sb) * w
    } else {
      const w = Math.random() * 0.22 // white mix for sparkle
      colors[idx] = r + (1 - r) * w
      colors[idx + 1] = g + (1 - g) * w
      colors[idx + 2] = b + (1 - b) * w
    }
  }

  const result = { positions, colors }
  targetsCache.set(emotion, result)
  return result
}
