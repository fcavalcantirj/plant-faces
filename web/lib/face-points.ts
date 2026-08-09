// Particle face geometry engine — PLANT edition.
// Every emotion is expressed as a target point cloud with per-particle colors.
// The renderer lerps particles from their current position toward the active
// emotion's targets, producing smooth morph transitions.
//
// The creature is a plant (Groot-planter energy). Head construction v8: there
// is NO dome — the tan bark face shell stops at the brow line (y ~0.55) and
// from there up the skull IS the crown: chunky tapered GREEN spike volumes
// rooted on a band spanning the full head width, center spikes tall and
// vertical, side spikes shorter and leaning outward, jagged silhouette wider
// than the face. Green crown vs tan face is what makes it read as a PLANT.
// Feature colors keep the emotion hue exactly — mood legibility is product
// law — the shell and crown only tint.
//
// v9 SOLIDITY: the v8 geometry was right but ~6.1k sparse additive points read
// as ghost-dust. The reference toy reads because surfaces are SOLID, so v9
// spends ~32k particles: the shell gains an interior flesh fill, the eye
// sockets are carved out of the shell (a glowing shell behind the discs would
// tan-wash them — with additive blending "dark" means the background must
// stop emitting), and the eye interior becomes a dense mid-dark green-brown
// mass under a blazing rim ring.

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
  // v9: ~32k total (×7 the v8 budget). Density is what buys the solid-material
  // read — WebGL points are near-free at this count and the per-frame morph
  // loop over 32k×3 floats is simple math, still comfortably 60fps.
  head: 12000,
  eye: 1600,
  mouth: 2200,
  brow: 500,
  sprout: 14000,
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
export const EYE_Y = 0.24
export const MOUTH_Y = -0.58
const BROW_Y = 0.6
const FEATURE_Z = 1.05
// The face shell ends here — above this line the skull IS the spike crown.
export const HEAD_CUT_Y = 0.72
// Crown vertical range: droop weighting, the renderer's sway, and the
// moss→leaf color gradient all grade from 0 at SPROUT_BASE_Y to 1 at
// SPROUT_BASE_Y + SPROUT_SPAN (the tip zone).
export const SPROUT_BASE_Y = 0.45
export const SPROUT_SPAN = 1.4

// ---------- face style (crown + eyes), parameterized for variant sweeps ----------

// Spike crown v4 (Groot skull): the upper head is a jagged row of chunky
// tapered bark spikes — filled cone volumes, not strokes — rooted on a band
// spanning the full head width. Tunables per preset:
export interface CrownStyle {
  id: string
  spikes: number // how many spike volumes make up the crown
  baseWidth: number // spike width at the root (world units); bases overlap
  tipHeightMin: number // shortest spike height above its root (band edges)
  tipHeightMax: number // tallest spike height (center of the band)
  outwardLean: number // radians the outermost spikes lean away from vertical
  jagness: number // 0..1 irregular height variation — jagged silhouette
}

// Groot eyes v3: huge wide-set dark discs with a bright rim ring and an
// offset catchlight cluster — the puppy-eye look.
export interface EyeStyle {
  id: string
  radius: number // disc radius (world units); face is ~2.6 wide
  rimBrightness: number // brightness multiplier on the rim ring
  fillDarkness: number // 0..1, how much the disc interior dims (1 = black)
  catchlight: boolean // upper-left sparkle cluster inside the disc
  separation: number // |x| of each eye center
}

export interface FaceStyle {
  crown: CrownStyle
  eye: EyeStyle
}

// The huge puppy eyes (e5) won the v-sweep outright — every spike preset
// keeps them exactly.
const EYE_E5: EyeStyle = {
  id: 'e5',
  radius: 0.36,
  rimBrightness: 1.4,
  fillDarkness: 0.68,
  catchlight: true,
  separation: 0.56,
}

export const FACE_PRESETS: Record<string, FaceStyle> = {
  // s1: 11 chunky spikes — the reference Groot-planter proportions
  s1: {
    crown: { id: 's1', spikes: 11, baseWidth: 0.22, tipHeightMin: 0.95, tipHeightMax: 1.5, outwardLean: 0.5, jagness: 0.4 },
    eye: EYE_E5,
  },
  // s2: 9 extra-chunky wide spikes — squat, maximum bark mass
  s2: {
    crown: { id: 's2', spikes: 9, baseWidth: 0.3, tipHeightMin: 0.9, tipHeightMax: 1.35, outwardLean: 0.6, jagness: 0.3 },
    eye: EYE_E5,
  },
  // s3: 13 sharper, taller spikes — the spiky maximalist
  s3: {
    crown: { id: 's3', spikes: 13, baseWidth: 0.17, tipHeightMin: 1.0, tipHeightMax: 1.9, outwardLean: 0.45, jagness: 0.6 },
    eye: EYE_E5,
  },
}

// Default: s1 — the chunky 11-spike crown closest to the planter reference.
export const DEFAULT_STYLE: FaceStyle = FACE_PRESETS.s1

let activeCrown: CrownStyle = DEFAULT_STYLE.crown
let activeEye: EyeStyle = DEFAULT_STYLE.eye

export function getFaceStyle(): FaceStyle {
  return { crown: activeCrown, eye: activeEye }
}

// Swap the active style. Clears the head + sprout + targets caches so the
// next buildTargets() call regenerates geometry (targets are also keyed by
// style id, so stale entries can never leak across styles). The head shell is
// style-dependent since v9: its eye sockets are carved to the eye preset.
export function setFaceStyle(crown: CrownStyle, eye: EyeStyle) {
  if (crown.id === activeCrown.id && eye.id === activeEye.id) return
  activeCrown = crown
  activeEye = eye
  headCache = null
  sproutCache = null
  targetsCache.clear()
}

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

// Filled cone volume (one crown spike): particles pack a tapered cone from a
// base disc to a sharp tip, density graded toward the base — overlapping
// roots fuse into one solid woody mass while the tips stay pointed.
function spikeVolume(
  out: Float32Array,
  start: number,
  count: number,
  b: [number, number, number],
  tip: [number, number, number],
  r0: number,
) {
  for (let i = 0; i < count; i++) {
    const t = Math.pow(Math.random(), 1.25) // dense at the base
    const r = r0 * (1 - t * 0.85)
    const a = Math.random() * Math.PI * 2
    // center-weighted radius: a bright solid core with a soft bark edge —
    // additive blending turns that density into the chunky-volume read
    const rad = Math.pow(Math.random(), 0.7) * r
    const idx = (start + i) * 3
    out[idx] = b[0] + (tip[0] - b[0]) * t + Math.cos(a) * rad
    out[idx + 1] = b[1] + (tip[1] - b[1]) * t + (Math.random() - 0.5) * r * 0.7
    out[idx + 2] = b[2] + (tip[2] - b[2]) * t + Math.sin(a) * rad
  }
}

// Particle roles inside the eye discs, used by the color pass:
// 0 = plain feature (emotion hue + sparkle), 1 = eye fill (dimmed),
// 2 = rim ring (bright, leans white), 3 = catchlight (near-white sparkle).
const ROLE_FILL = 1
const ROLE_RIM = 2
const ROLE_CATCH = 3

// Groot eye v3: big dark filled disc + bright rim ring at the circumference +
// an offset catchlight cluster in the upper-left of the disc (puppy eyes).
// ringScale > 1 widens/densifies the rim (alert/surprised).
function grootEye(
  out: Float32Array,
  roles: Uint8Array,
  start: number,
  count: number,
  cx: number,
  cy: number,
  r: number,
  ringScale = 1,
) {
  // v9 split: the FILL is the majority — a dense solid dark disc is what makes
  // the puppy eye read; the rim stays a tight band (fewer particles than v8
  // proportionally, still blazing at this density), catchlight scales with the
  // budget but stays a tight cluster so it stacks into one sparkle.
  const catchN = activeEye.catchlight ? Math.max(14, Math.floor(count * 0.025)) : 0
  const rimN = Math.floor(count * Math.min(0.3 * (0.7 + 0.3 * ringScale), 0.45))
  const fillN = count - rimN - catchN
  let i = start
  // dark interior disc — dense, reads as one solid mass over the carved socket
  for (let k = 0; k < fillN; k++, i++) {
    const a = Math.random() * Math.PI * 2
    const rad = Math.sqrt(Math.random()) * r * 0.93
    const idx = i * 3
    out[idx] = cx + Math.cos(a) * rad
    out[idx + 1] = cy + Math.sin(a) * rad
    out[idx + 2] = FEATURE_Z + (Math.random() - 0.5) * 0.06
    roles[i] = ROLE_FILL
  }
  // bright rim ring, dense at the circumference (tight band = crisp ring)
  const w = r * 0.11 * ringScale
  for (let k = 0; k < rimN; k++, i++) {
    const a = Math.random() * Math.PI * 2
    const rad = r + (Math.random() - 0.6) * w
    const idx = i * 3
    out[idx] = cx + Math.cos(a) * rad
    out[idx + 1] = cy + Math.sin(a) * rad
    out[idx + 2] = FEATURE_Z + 0.02 + (Math.random() - 0.5) * 0.05
    roles[i] = ROLE_RIM
  }
  // catchlight cluster, offset upper-left, floats in front of the fill —
  // tight so the particles stack into one bright sparkle
  for (let k = 0; k < catchN; k++, i++) {
    const a = Math.random() * Math.PI * 2
    const rad = Math.sqrt(Math.random()) * r * 0.12
    const idx = i * 3
    out[idx] = cx - r * 0.38 + Math.cos(a) * rad
    out[idx + 1] = cy + r * 0.36 + Math.sin(a) * rad
    out[idx + 2] = FEATURE_Z + 0.1
    roles[i] = ROLE_CATCH
  }
}

// ---------- face shell (shared across all emotions) ----------

let headCache: Float32Array | null = null

// True when (x, y) sits inside either eye's socket footprint. The shell is
// carved thin + dimmed here: with additive blending the dark eye discs can
// only read DARK if the shell stops emitting behind them.
function inEyeSocket(x: number, y: number): boolean {
  const R = activeEye.radius * 1.08
  const dy = y - EYE_Y
  const dl = x + activeEye.separation
  const dr = x - activeEye.separation
  return dl * dl + dy * dy < R * R || dr * dr + dy * dy < R * R
}

// v8: FACE only — the ellipsoid shell stops at HEAD_CUT_Y (the brow line).
// There is NO dome above it; the spike crown replaces the entire top. The
// lower half keeps the jaw/cheek/chin roundness, pulled slightly narrower so
// the crown reads wider than the face.
// v9: SOLID — ~30% of the budget fills the interior just under the skin so
// the face has flesh behind it, the front thinning is mostly gone (features
// win by color contrast now, not by shell absence), and the eye sockets are
// carved to ~30% density so the dark discs actually read dark.
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
    // ease the very front off a touch so features keep a hair of relief
    if (z > 0.72 && Math.random() < 0.4) continue
    const j = 0.97 + Math.random() * 0.06
    const up = Math.max(0, u)
    const dn = Math.max(0, -u)
    const taper = 1 - 0.18 * up * up
    const jaw = 1 - 0.1 * dn * dn // slightly narrower jaw than v7
    const yScale = 1.68 + 0.1 * up
    const wy = y * yScale * j
    // the dome is GONE — everything above the brow line is crown territory
    if (wy > HEAD_CUT_Y) continue
    // interior flesh: ~45% of particles sink to 0.72–0.98 of surface radius.
    // The deep fill matters twice: flesh behind the skin, and a projection
    // profile that peaks at the FACE CENTER — countering the surface shell's
    // tangential edge-stacking so the additive sum stays flat, not rim-hot.
    const f = Math.random() < 0.45 ? 0.72 + Math.random() * 0.26 : 1
    const px = x * 1.32 * taper * jaw * j * f
    const py = wy * f
    const pz = z * 1.02 * taper * j * f
    // carve the eye sockets to ~30% density (the color pass dims survivors)
    if (inEyeSocket(px, py) && Math.random() < 0.7) continue
    const idx = i * 3
    out[idx] = px
    out[idx + 1] = py
    out[idx + 2] = pz
    i++
  }
  headCache = out
  return out
}

// ---------- spike crown (shared geometry; wilt is applied per emotion) ----------

let sproutCache: Float32Array | null = null

// The root band's height at band position f (-1 = left edge .. 1 = right
// edge): highest at center (~0.85), dipping to ~0.67 at the edges — ABOVE the
// eye tops (EYE_Y 0.24 + radius 0.36 = 0.60), so the green mass never buries
// the puppy eyes: they sit clear in the tan face, the way the planter does it.
function bandY(f: number): number {
  return 0.85 - 0.18 * Math.pow(Math.abs(f), 1.5)
}

// z of the (slightly inset) head surface at (x, y) — roots sit ON the skull.
function bandZ(x: number, y: number): number {
  return 0.72 * Math.sqrt(Math.max(0.05, 1 - (x / 1.32) ** 2 - (y / 1.68) ** 2))
}

// Spike crown v4: the upper head IS this. A jagged row of chunky tapered
// spike volumes rooted on a band spanning the full head width (y ~0.35..0.6).
// The center spike rises tallest and vertical, side spikes run shorter and
// lean outward (tips pass the face's silhouette — the crown reads WIDER than
// the face), alternate spikes drop back a step for depth and a couple rake
// backward. ~15% of the particle budget welds the root band into a continuous
// moss mass, so no gap — and no dome — ever shows between the bases.
function getSprout(): Float32Array {
  if (sproutCache) return sproutCache
  const st = activeCrown
  const out = new Float32Array(COUNTS.sprout * 3)

  // deterministic per-spike jitter: a preset always grows the same crown
  const hash = (k: number) => {
    const s = Math.sin(k * 127.1 + st.spikes * 311.7) * 43758.5453
    return s - Math.floor(s)
  }

  const n = st.spikes
  interface Spike {
    b: [number, number, number]
    tip: [number, number, number]
    r0: number
    weight: number
  }
  const spikes: Spike[] = []
  const backA = Math.round(n * 0.27) // these two rake slightly backward
  const backB = Math.round(n * 0.73)
  for (let i = 0; i < n; i++) {
    const f = (i / (n - 1)) * 2 - 1 // -1 (left edge) .. 1 (right edge)
    const bx = f * 1.16 + (hash(i * 3 + 1) - 0.5) * 0.06
    const by = bandY(f) + (hash(i * 3 + 2) - 0.5) * 0.06
    // roots on the skull surface; every other spike steps back for depth
    // (center spike always front row so the silhouette peak faces camera)
    const row = Math.abs(i - (n - 1) / 2) % 2
    const bz = bandZ(bx, by) - row * 0.32
    // height: tallest at center, shorter at the edges, jagged in between
    const centered = 1 - Math.abs(f)
    let jag = (hash(i * 3) - 0.5) * st.jagness * 0.9 * (st.tipHeightMax - st.tipHeightMin)
    if (centered > 0.9) jag = Math.abs(jag) * 0.3 // center stays tallest
    const h = Math.min(
      st.tipHeightMax,
      Math.max(
        st.tipHeightMin * 0.85,
        st.tipHeightMin + (st.tipHeightMax - st.tipHeightMin) * Math.pow(centered, 1.15) + jag,
      ),
    )
    // lean: vertical at center, outward toward the edges
    const lean = st.outwardLean * Math.abs(f) * (0.8 + hash(i * 7) * 0.4)
    const back = i === backA || i === backB ? 0.3 : 0.06 + hash(i * 5) * 0.06
    const tip: [number, number, number] = [
      bx + Math.sin(lean) * h * (f === 0 ? 1 : Math.sign(f)),
      by + Math.cos(lean) * h,
      bz - back * h,
    ]
    const r0 = (st.baseWidth / 2) * (0.9 + hash(i * 11) * 0.25)
    // roots start a hair inside the head so the joint never shows a seam
    spikes.push({ b: [bx, by - 0.08, bz], tip, r0, weight: r0 * r0 * h })
  }

  // ~12% of the budget packs the root band; the rest fills spike volumes,
  // split proportional to each spike's volume (cumulative rounding spends
  // the budget exactly with no spike starved)
  const bandN = Math.floor(COUNTS.sprout * 0.12)
  const budget = COUNTS.sprout - bandN
  const totalW = spikes.reduce((a, s) => a + s.weight, 0)
  let at = 0
  let wAcc = 0
  for (let si = 0; si < spikes.length; si++) {
    const s = spikes[si]
    wAcc += s.weight
    const end = si === spikes.length - 1 ? budget : Math.round((budget * wAcc) / totalW)
    const cnt = end - at
    if (cnt > 0) spikeVolume(out, at, cnt, s.b, s.tip, s.r0)
    at = end
  }

  // base mass: moss packed along the root band, hugging the skull surface —
  // fuses the spike bases into one continuous jagged mass
  for (let i = at; i < COUNTS.sprout; i++) {
    const f = Math.random() * 2 - 1
    const bx = f * 1.2 + (Math.random() - 0.5) * 0.08
    const by =
      bandY(f) + (Math.random() - 0.5) * 0.18 + Math.pow(Math.random(), 2) * 0.22
    const idx = i * 3
    out[idx] = bx
    out[idx + 1] = by
    out[idx + 2] = bandZ(bx, by) - Math.random() * 0.38
  }

  sproutCache = out
  return out
}

// ---------- per-emotion targets ----------

export interface EmotionTargets {
  positions: Float32Array
  colors: Float32Array
}

// Keyed by (crown id | eye id | emotion) so styles never leak into each other;
// setFaceStyle also clears it outright.
const targetsCache = new Map<string, EmotionTargets>()

export function buildTargets(emotion: Emotion): EmotionTargets {
  const cacheKey = `${activeCrown.id}|${activeEye.id}|${emotion}`
  const cached = targetsCache.get(cacheKey)
  if (cached) return cached

  const positions = new Float32Array(TOTAL * 3)
  positions.set(getHeadShell(), 0)
  const roles = new Uint8Array(TOTAL)

  const [lE] = RANGES.leftEye
  const [rE] = RANGES.rightEye
  const [m] = RANGES.mouth
  const [lB] = RANGES.leftBrow
  const [rB] = RANGES.rightBrow
  const [sp] = RANGES.sprout

  // eye style shorthands; brows ride up so bigger eyes never collide with them
  const R = activeEye.radius
  const EX = activeEye.separation
  const BY = Math.max(BROW_Y, EYE_Y + R + 0.13)

  // spike crown: same geometry for every emotion, wilted by the emotion's
  // droop — the crown sags: spikes shrink ~15% in y and lean further outward,
  // tips travel furthest
  positions.set(getSprout(), sp * 3)
  const droop = SPROUT_DROOP[emotion]
  if (droop > 0) {
    for (let i = sp; i < TOTAL; i++) {
      const idx = i * 3
      const h = positions[idx + 1] - SPROUT_BASE_Y
      if (h <= 0) continue
      const w = Math.min(h / SPROUT_SPAN, 1)
      positions[idx + 1] = SPROUT_BASE_Y + h * (1 - 0.15 * droop) // crown sags
      positions[idx] *= 1 + droop * 0.2 * w // spikes splay outward
    }
  }

  switch (emotion) {
    case 'neutral': {
      // huge dark puppy discs with bright rims (+ catchlight)
      grootEye(positions, roles, lE, COUNTS.eye, -EX, EYE_Y, R)
      grootEye(positions, roles, rE, COUNTS.eye, EX, EYE_Y, R)
      bezierStroke(positions, m, COUNTS.mouth, [-0.34, -0.56], [0, -0.64], [0.34, -0.56], 0.07)
      leafTuft(positions, lB, COUNTS.brow, [-EX - 0.17, BY - 0.02], [-EX, BY + 0.06], [-EX + 0.17, BY - 0.02], 0.075)
      leafTuft(positions, rB, COUNTS.brow, [EX - 0.17, BY - 0.02], [EX, BY + 0.06], [EX + 0.17, BY - 0.02], 0.075)
      break
    }
    case 'thinking': {
      // eyes drift up-right (slightly smaller discs), one tuft raised
      grootEye(positions, roles, lE, COUNTS.eye, -EX + 0.09, EYE_Y + 0.08, R * 0.78)
      grootEye(positions, roles, rE, COUNTS.eye, EX + 0.09, EYE_Y + 0.08, R * 0.78)
      bezierStroke(positions, m, COUNTS.mouth, [-0.06, -0.56], [0.12, -0.59], [0.3, -0.54], 0.06)
      leafTuft(positions, lB, COUNTS.brow, [-EX - 0.17, BY + 0.1], [-EX, BY + 0.22], [-EX + 0.17, BY + 0.08], 0.075)
      leafTuft(positions, rB, COUNTS.brow, [EX - 0.17, BY - 0.05], [EX, BY - 0.01], [EX + 0.17, BY - 0.05], 0.075)
      break
    }
    case 'speaking': {
      grootEye(positions, roles, lE, COUNTS.eye, -EX, EYE_Y, R * 0.92)
      grootEye(positions, roles, rE, COUNTS.eye, EX, EYE_Y, R * 0.92)
      rimEllipse(positions, m, COUNTS.mouth, 0, MOUTH_Y, 0.24, 0.16)
      leafTuft(positions, lB, COUNTS.brow, [-EX - 0.17, BY - 0.02], [-EX, BY + 0.06], [-EX + 0.17, BY - 0.02], 0.075)
      leafTuft(positions, rB, COUNTS.brow, [EX - 0.17, BY - 0.02], [EX, BY + 0.06], [EX + 0.17, BY - 0.02], 0.075)
      break
    }
    case 'happy': {
      // closed crescent eyes (scaled to the eye radius) + wide smile
      arcStroke(positions, lE, COUNTS.eye, -EX, EYE_Y - 0.07, R, Math.PI * 0.15, Math.PI * 0.85, 0.07)
      arcStroke(positions, rE, COUNTS.eye, EX, EYE_Y - 0.07, R, Math.PI * 0.15, Math.PI * 0.85, 0.07)
      bezierStroke(positions, m, COUNTS.mouth, [-0.44, -0.46], [0, -0.88], [0.44, -0.46], 0.08)
      leafTuft(positions, lB, COUNTS.brow, [-EX - 0.17, BY + 0.06], [-EX, BY + 0.16], [-EX + 0.17, BY + 0.06], 0.075)
      leafTuft(positions, rB, COUNTS.brow, [EX - 0.17, BY + 0.06], [EX, BY + 0.16], [EX + 0.17, BY + 0.06], 0.075)
      break
    }
    case 'alert': {
      // the big disc with a widened ring, small open mouth, tufts high
      grootEye(positions, roles, lE, COUNTS.eye, -EX, EYE_Y, R * 1.05, 1.6)
      grootEye(positions, roles, rE, COUNTS.eye, EX, EYE_Y, R * 1.05, 1.6)
      rimEllipse(positions, m, COUNTS.mouth, 0, MOUTH_Y - 0.02, 0.11, 0.13, 0.2)
      leafTuft(positions, lB, COUNTS.brow, [-EX - 0.19, BY + 0.08], [-EX, BY + 0.2], [-EX + 0.19, BY + 0.12], 0.075)
      leafTuft(positions, rB, COUNTS.brow, [EX - 0.19, BY + 0.12], [EX, BY + 0.2], [EX + 0.19, BY + 0.08], 0.075)
      break
    }
    case 'sad': {
      // downcast discs with a tear under the left one, inner-raised tufts, frown
      // (tear share shrank v8's 14% -> 5%: at v9 density 14% additively nukes)
      const tear = Math.floor(COUNTS.eye * 0.05)
      grootEye(positions, roles, lE, COUNTS.eye - tear, -EX, EYE_Y - 0.05, R * 0.85)
      fillCircle(positions, lE + COUNTS.eye - tear, tear, -EX - 0.08, EYE_Y - 0.52, 0.05)
      grootEye(positions, roles, rE, COUNTS.eye, EX, EYE_Y - 0.05, R * 0.85)
      bezierStroke(positions, m, COUNTS.mouth, [-0.3, -0.64], [0, -0.44], [0.3, -0.64], 0.07)
      leafTuft(positions, lB, COUNTS.brow, [-EX - 0.17, BY - 0.06], [-EX, BY + 0.04], [-EX + 0.17, BY + 0.12], 0.075)
      leafTuft(positions, rB, COUNTS.brow, [EX - 0.17, BY + 0.12], [EX, BY + 0.04], [EX + 0.17, BY - 0.06], 0.075)
      break
    }
    case 'angry': {
      // narrowed eyes, steep inward-slanted tufts, tight downturned mouth
      rimEllipse(positions, lE, COUNTS.eye, -EX, EYE_Y, R * 0.9, R * 0.34, 0.6)
      rimEllipse(positions, rE, COUNTS.eye, EX, EYE_Y, R * 0.9, R * 0.34, 0.6)
      bezierStroke(positions, m, COUNTS.mouth, [-0.26, -0.56], [0, -0.52], [0.26, -0.56], 0.06)
      leafTuft(positions, lB, COUNTS.brow, [-EX - 0.19, BY + 0.1], [-EX, BY - 0.02], [-EX + 0.17, BY - 0.14], 0.075)
      leafTuft(positions, rB, COUNTS.brow, [EX - 0.17, BY - 0.14], [EX, BY - 0.02], [EX + 0.19, BY + 0.1], 0.075)
      break
    }
    case 'surprised': {
      // hugest discs with the widest rings, sky-high tufts, big O mouth
      grootEye(positions, roles, lE, COUNTS.eye, -EX, EYE_Y + 0.03, R * 1.12, 1.8)
      grootEye(positions, roles, rE, COUNTS.eye, EX, EYE_Y + 0.03, R * 1.12, 1.8)
      rimEllipse(positions, m, COUNTS.mouth, 0, MOUTH_Y - 0.04, 0.17, 0.22, 0.25)
      leafTuft(positions, lB, COUNTS.brow, [-EX - 0.19, BY + 0.16], [-EX, BY + 0.3], [-EX + 0.19, BY + 0.16], 0.075)
      leafTuft(positions, rB, COUNTS.brow, [EX - 0.19, BY + 0.16], [EX, BY + 0.3], [EX + 0.19, BY + 0.16], 0.075)
      break
    }
    case 'confused': {
      // asymmetric everything: one wide disc, one squint, mismatched tufts, squiggle mouth
      grootEye(positions, roles, lE, COUNTS.eye, -EX, EYE_Y + 0.05, R)
      rimEllipse(positions, rE, COUNTS.eye, EX, EYE_Y - 0.02, R * 0.72, R * 0.34, 0.6)
      squiggleStroke(positions, m, COUNTS.mouth, 0.02, MOUTH_Y + 0.02, 0.3, 0.05, 0.06)
      leafTuft(positions, lB, COUNTS.brow, [-EX - 0.17, BY + 0.14], [-EX, BY + 0.26], [-EX + 0.17, BY + 0.12], 0.075)
      leafTuft(positions, rB, COUNTS.brow, [EX - 0.17, BY - 0.08], [EX, BY - 0.06], [EX + 0.17, BY - 0.08], 0.075)
      break
    }
    case 'sleepy': {
      // heavy half-closed lids (scaled), relaxed low tufts, small slack mouth
      arcStroke(positions, lE, COUNTS.eye, -EX, EYE_Y + 0.08, R, Math.PI * 1.15, Math.PI * 1.85, 0.07)
      arcStroke(positions, rE, COUNTS.eye, EX, EYE_Y + 0.08, R, Math.PI * 1.15, Math.PI * 1.85, 0.07)
      rimEllipse(positions, m, COUNTS.mouth, 0, MOUTH_Y, 0.1, 0.08, 0.4)
      leafTuft(positions, lB, COUNTS.brow, [-EX - 0.17, BY - 0.12], [-EX, BY - 0.08], [-EX + 0.17, BY - 0.12], 0.075)
      leafTuft(positions, rB, COUNTS.brow, [EX - 0.17, BY - 0.12], [EX, BY - 0.08], [EX + 0.17, BY - 0.12], 0.075)
      break
    }
    case 'love': {
      // heart-shaped eyes (scaled so the heart spans the disc) + warm smile
      heartStroke(positions, lE, COUNTS.eye, -EX, EYE_Y, R / 16, 0.06)
      heartStroke(positions, rE, COUNTS.eye, EX, EYE_Y, R / 16, 0.06)
      bezierStroke(positions, m, COUNTS.mouth, [-0.38, -0.5], [0, -0.8], [0.38, -0.5], 0.08)
      leafTuft(positions, lB, COUNTS.brow, [-EX - 0.17, BY + 0.04], [-EX, BY + 0.14], [-EX + 0.17, BY + 0.04], 0.075)
      leafTuft(positions, rB, COUNTS.brow, [EX - 0.17, BY + 0.04], [EX, BY + 0.14], [EX + 0.17, BY + 0.04], 0.075)
      break
    }
    case 'glitch': {
      // X-ed out eyes (scaled), flatlined mouth, skewed tufts — signal lost
      const half = Math.floor(COUNTS.eye / 2)
      const xr = R * 0.72
      bezierStroke(positions, lE, half, [-EX - xr, EYE_Y + xr], [-EX, EYE_Y], [-EX + xr, EYE_Y - xr], 0.05)
      bezierStroke(positions, lE + half, COUNTS.eye - half, [-EX - xr, EYE_Y - xr], [-EX, EYE_Y], [-EX + xr, EYE_Y + xr], 0.05)
      bezierStroke(positions, rE, half, [EX - xr, EYE_Y + xr], [EX, EYE_Y], [EX + xr, EYE_Y - xr], 0.05)
      bezierStroke(positions, rE + half, COUNTS.eye - half, [EX - xr, EYE_Y - xr], [EX, EYE_Y], [EX + xr, EYE_Y + xr], 0.05)
      bezierStroke(positions, m, COUNTS.mouth, [-0.34, MOUTH_Y], [0, MOUTH_Y], [0.34, MOUTH_Y], 0.05)
      leafTuft(positions, lB, COUNTS.brow, [-EX - 0.17, BY + 0.02], [-EX, BY + 0.04], [-EX + 0.17, BY - 0.04], 0.075)
      leafTuft(positions, rB, COUNTS.brow, [EX - 0.17, BY - 0.04], [EX, BY + 0.04], [EX + 0.17, BY + 0.02], 0.075)
      break
    }
  }

  // colors — the plant read lives here: GREEN crown vs TAN face.
  // - face shell: warm bright bark tan (~0.55,0.42,0.26 varied) with faint
  //   vertical striations — reads wood, not gray
  // - spike crown: moss-to-leaf gradient, dark green at the roots grading
  //   brighter toward the tips, light sparkle at the tips
  // - both take the emotion hue as a ~25% multiplicative wash (angry warms the
  //   whole being, love pinks it) — multiplicative so the cyan NEUTRAL hue
  //   can't drown the tan into olive-gray
  // - features (eyes/mouth): the emotion hue exactly, with white sparkle
  // - brow tufts: dim bark ridges (structure, not hair) with enough emotion
  //   hue to keep the angry/sad/surprised slants legible
  // - eye roles override: fill dims (dark disc), rim leans white and brightens,
  //   catchlight is a near-white sparkle
  const colors = new Float32Array(TOTAL * 3)
  const [r, g, b] = EMOTION_META[emotion].rgb
  // ~25% emotion wash, applied as a per-channel gain around 1.0
  const washR = 0.78 + 0.3 * r
  const washG = 0.78 + 0.3 * g
  const washB = 0.78 + 0.3 * b
  for (let i = 0; i < TOTAL; i++) {
    const idx = i * 3
    if (i < COUNTS.head) {
      const px = positions[idx]
      const py = positions[idx + 1]
      const pz = positions[idx + 2]
      // deterministic per-particle noise from the cached shell position, so
      // the bark pattern holds steady while emotions morph over it
      const h1 = Math.sin(px * 12.9898 + py * 78.233 + pz * 37.719) * 43758.5453
      const mixN = h1 - Math.floor(h1) // light <-> dark bark mix
      const h2 = Math.sin(px * 63.726 + py * 11.135 + pz * 91.532) * 24634.6345
      const varN = h2 - Math.floor(h2) // brightness variation
      const baseR = 0.5 * (1 - mixN) + 0.62 * mixN
      const baseG = 0.36 * (1 - mixN) + 0.47 * mixN
      const baseB = 0.2 * (1 - mixN) + 0.3 * mixN
      // faint vertical bark stripes
      const stripe = 0.8 + 0.2 * Math.sin(Math.atan2(px, pz) * 9 + py * 2)
      // ×1.1: +10% over v8 to offset the smaller sprites; socket survivors
      // dim hard so the dark eye discs stay dark against the tan
      const socket = inEyeSocket(px, py) ? 0.35 : 1
      const v = (0.78 + varN * 0.26) * stripe * 1.1 * socket
      colors[idx] = baseR * washR * v
      colors[idx + 1] = baseG * washG * v
      colors[idx + 2] = baseB * washB * v
    } else if (i >= sproutStart) {
      // moss at the roots -> bright leaf at the tips. Values run ~25% hotter
      // than the perceptual targets (base ~0.20,0.35,0.15 / tip ~0.45,0.75,0.3)
      // because the soft additive sprite dims everything it draws.
      const tf = Math.min(Math.max((positions[idx + 1] - SPROUT_BASE_Y) / SPROUT_SPAN, 0), 1)
      const gr = (0.2 + 0.24 * tf) * washR
      const gg = (0.46 + 0.5 * tf) * washG
      const gb = (0.16 + 0.14 * tf) * washB
      // sparkle trimmed 0.2 -> 0.12 for v9: at ~6x density the additive white
      // mix compounds and the tips were bleaching to mint-white
      const w = tf * tf * Math.random() * 0.12
      colors[idx] = gr + (1 - gr) * w
      colors[idx + 1] = Math.min(1, gg + (1 - gg) * w)
      colors[idx + 2] = gb + (1 - gb) * w
    } else if (i >= leftBrowStart) {
      // bark-ridge brows: brighter than v8 (0.34 -> 0.52 base, 40% emotion) —
      // against the v9 SOLID shell the old dim ridges vanished entirely and
      // took the angry/sad/surprised slant semantics with them
      const v = 0.52 + Math.random() * 0.2
      colors[idx] = (0.5 * 0.6 + r * 0.4) * v
      colors[idx + 1] = (0.38 * 0.6 + g * 0.4) * v
      colors[idx + 2] = (0.24 * 0.6 + b * 0.4) * v
    } else if (roles[i] === ROLE_FILL) {
      // dense mid-dark green-brown disc: dark enough to read as the pupil
      // mass over the carved socket, organic rather than pure emotion glow —
      // a 25% whisper of the emotion hue keeps the mood wash coherent
      const d = (1 - activeEye.fillDarkness) * (0.7 + Math.random() * 0.35)
      colors[idx] = (0.3 + r * 0.25) * d
      colors[idx + 1] = (0.36 + g * 0.25) * d
      colors[idx + 2] = (0.2 + b * 0.25) * d
    } else if (roles[i] === ROLE_RIM) {
      // bright rim: leans white, boosted by rimBrightness
      const mixW = 0.7
      const br = activeEye.rimBrightness
      colors[idx] = Math.min(1, (r + (1 - r) * mixW) * br)
      colors[idx + 1] = Math.min(1, (g + (1 - g) * mixW) * br)
      colors[idx + 2] = Math.min(1, (b + (1 - b) * mixW) * br)
    } else if (roles[i] === ROLE_CATCH) {
      // catchlight: essentially white with a whisper of the emotion hue
      colors[idx] = 0.92 + r * 0.08
      colors[idx + 1] = 0.92 + g * 0.08
      colors[idx + 2] = 0.92 + b * 0.08
    } else {
      const w = Math.random() * 0.22 // white mix for sparkle
      colors[idx] = r + (1 - r) * w
      colors[idx + 1] = g + (1 - g) * w
      colors[idx + 2] = b + (1 - b) * w
    }
  }

  const result = { positions, colors }
  targetsCache.set(cacheKey, result)
  return result
}
