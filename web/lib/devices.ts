// Admin minting and publishing — the testable logic behind /api/devices.
//
// Minting (POST) is the only way a source token and its plant come into
// existence: one validated request creates the plant row, claims the optional
// public slug, and registers the source — after which the token's readings
// stop evaporating (the retention split in store.ts). Publishing (PATCH) is
// the separate, deliberate act minting refuses to bundle: plants are born
// private, and only an explicit flip here makes /api/public/[slug] answer.
// The route handler stays thin; everything with behavior worth pinning lives
// here.
//
// The value imports carry explicit .ts extensions because lib code runs under
// node --experimental-strip-types in tests, whose resolver requires them.

import { randomBytes } from 'node:crypto'
import { SPECIES } from './species.ts'
import { getPlant, registerSource, upsertPlant, type PlantRecord } from './store.ts'

export interface MintRequest {
  label: string
  species: string
  stage: string | null
  slug?: string
  adapter: string
}

export type MintParse = { ok: true; body: MintRequest } | { ok: false; error: string }

const MINT_KEYS = ['label', 'species', 'stage', 'slug', 'adapter'] as const

/** A slug becomes a URL path segment: lowercase, digits, inner hyphens, ≤64. */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

/**
 * Validate a mint body. Same honesty gate as the ingest door: unknown fields
 * are refused by name, values are refused rather than coerced, and an unknown
 * species is an error naming the known ones — never a silent default profile
 * (speciesById's display fallback has no business minting registry rows). A
 * stage only mints if the species profile actually declares it.
 */
export function parseMintBody(raw: unknown): MintParse {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'body must be an object' }
  }
  const b = raw as Record<string, unknown>
  for (const k of Object.keys(b)) {
    if (!(MINT_KEYS as readonly string[]).includes(k)) {
      return { ok: false, error: `${k} is not a recognized mint field` }
    }
  }

  if (typeof b.label !== 'string' || b.label.trim().length === 0 || b.label.length > 80) {
    return { ok: false, error: 'label must be a non-empty string of at most 80 characters' }
  }
  const ids = SPECIES.map((s) => s.id)
  if (typeof b.species !== 'string' || !ids.includes(b.species)) {
    return { ok: false, error: `species must be one of: ${ids.join(', ')}` }
  }
  if (b.stage !== undefined && (typeof b.stage !== 'string' || b.stage.trim().length === 0)) {
    return { ok: false, error: 'stage, when given, must be a non-empty string' }
  }
  // A stage the species never declared used to sail through this door and
  // detonate later at withStage, mid-judgment — refuse-don't-clamp firing at
  // the wrong door. Refuse it HERE, at the mint, while the keeper is still on
  // the line to fix the typo. Object.hasOwn, as in withStage: a stage named
  // "toString" is unknown. The species id was validated above, so this lookup
  // cannot miss.
  if (typeof b.stage === 'string') {
    const profile = SPECIES.find((s) => s.id === b.species)!
    if (!(profile.stages && Object.hasOwn(profile.stages, b.stage))) {
      const known = profile.stages ? Object.keys(profile.stages) : []
      return {
        ok: false,
        error: known.length
          ? `species ${profile.id} has no stage "${b.stage}" — its stages are: ${known.join(', ')}`
          : `species ${profile.id} has no stages — omit stage "${b.stage}"`,
      }
    }
  }
  if (b.slug !== undefined && (typeof b.slug !== 'string' || !SLUG_RE.test(b.slug))) {
    return {
      ok: false,
      error: 'slug, when given, must be lowercase letters/digits/hyphens with no leading or trailing hyphen',
    }
  }
  if (b.adapter !== undefined && (typeof b.adapter !== 'string' || b.adapter.trim().length === 0)) {
    return { ok: false, error: 'adapter, when given, must be a non-empty string' }
  }

  return {
    ok: true,
    body: {
      label: b.label,
      species: b.species,
      stage: (b.stage as string | undefined) ?? null,
      slug: b.slug as string | undefined,
      // An explicit recorded value, not a guess: the adapter is declared
      // intent, and "unspecified" is an honest declaration of none.
      adapter: (b.adapter as string | undefined) ?? 'unspecified',
    },
  }
}

/** 'src_' + 24 hex chars: 96 random bits — unguessable, greppable by prefix. */
export function mintSourceToken(): string {
  return 'src_' + randomBytes(12).toString('hex')
}

/** 'plt_' + 16 hex chars. Plant ids are internal; slugs are the public name. */
export function mintPlantId(): string {
  return 'plt_' + randomBytes(8).toString('hex')
}

/**
 * Create the registry rows for a validated mint. Plant first, then source: if
 * the second write dies we strand an unreferenced plant row, never a token
 * that is half-registered. Plants are born private — publishing is a separate,
 * deliberate act.
 */
export async function mintDevice(
  body: MintRequest,
  now: number,
): Promise<{ sourceToken: string; plantId: string }> {
  const sourceToken = mintSourceToken()
  const plantId = mintPlantId()
  const plant: PlantRecord = {
    label: body.label,
    species: body.species,
    stage: body.stage,
    sources: [sourceToken],
    public: false,
  }
  await upsertPlant(plantId, plant, body.slug)
  await registerSource(sourceToken, { plant_id: plantId, adapter: body.adapter, claimed_at: now })
  return { sourceToken, plantId }
}

// ── the public flip ─────────────────────────────────────────────────────────

export interface PatchRequest {
  plant_id: string
  public: boolean
}

export type PatchParse = { ok: true; body: PatchRequest } | { ok: false; error: string }

const PATCH_KEYS = ['plant_id', 'public'] as const

/**
 * Validate a public-flip body. Same honesty gate as the mint above: unknown
 * fields are refused by name, and `public` must be an actual boolean — a
 * "true" string or a 1 is refused, never coerced, because the difference
 * between a plant that is public and one that is not must never hinge on a
 * truthiness accident.
 */
export function parsePatchBody(raw: unknown): PatchParse {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'body must be an object' }
  }
  const b = raw as Record<string, unknown>
  for (const k of Object.keys(b)) {
    if (!(PATCH_KEYS as readonly string[]).includes(k)) {
      return { ok: false, error: `${k} is not a recognized patch field` }
    }
  }
  if (typeof b.plant_id !== 'string' || b.plant_id.trim().length === 0) {
    return { ok: false, error: 'plant_id must be a non-empty string' }
  }
  if (typeof b.public !== 'boolean') {
    return { ok: false, error: 'public must be true or false — a boolean, not a look-alike' }
  }
  return { ok: true, body: { plant_id: b.plant_id, public: b.public } }
}

/**
 * Flip a plant's public bit. The one registry mutation this door performs:
 * read the row, rewrite it with the new bit, touch nothing else — label,
 * species, stage, sources and slug all survive verbatim. An unknown plant_id
 * returns null for the route to 404; a flip must never upsert a plant into
 * existence. Re-flipping to the current state is an idempotent rewrite, not
 * an error — PATCH twice, same world.
 */
export async function applyPublicFlip(body: PatchRequest): Promise<PlantRecord | null> {
  const plant = await getPlant(body.plant_id)
  if (plant === null) return null
  const updated: PlantRecord = { ...plant, public: body.public }
  await upsertPlant(body.plant_id, updated)
  return updated
}
