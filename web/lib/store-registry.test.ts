// Run: pnpm test
//
// The source/plant registry and the retention split it drives. The memory
// backend carries most of the suite; the TTL semantics themselves are KV-only,
// so the EXPIRE/PERSIST branch is pinned against a scripted fetch that plays
// Upstash — commands recorded, no network.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  append,
  getPlant,
  getPlantBySlug,
  getSource,
  readings,
  registerSource,
  shouldExpire,
  storeMode,
  upsertPlant,
  SlugTakenError,
  type PlantRecord,
} from './store.ts'
import {
  applyPublicFlip,
  mintDevice,
  mintPlantId,
  mintSourceToken,
  parseMintBody,
  parsePatchBody,
} from './devices.ts'

// The suite exercises the in-process backend. KV env leaking in from the
// shell would silently turn these into network tests — strip it up front.
delete process.env.KV_REST_API_URL
delete process.env.UPSTASH_REDIS_REST_URL
delete process.env.KV_REST_API_TOKEN
delete process.env.UPSTASH_REDIS_REST_TOKEN
delete process.env.VERCEL

const NOW = 1_754_650_000_000

const reading = (ts: number) => ({ moisture: 42.1, soilTemp: 22.4, ec: 1.15, ph: 6.3, ts })

const plant = (over: Partial<PlantRecord> = {}): PlantRecord => ({
  label: 'Thalesadão',
  species: 'pothos',
  stage: 'vega',
  sources: ['src_aaaaaaaaaaaaaaaaaaaaaaaa'],
  public: false,
  ...over,
})

// ── registry CRUD ───────────────────────────────────────────────────────────

test('registry: source round-trips and unknown tokens are null', async () => {
  assert.equal(storeMode(), 'memory', 'suite must run on the in-process backend')
  assert.equal(await getSource('src_never_registered_0000'), null)
  const rec = { plant_id: 'plt_0011223344556677', adapter: 'thcphs-esp32', claimed_at: NOW }
  await registerSource('src_roundtrip_test_000000', rec)
  assert.deepEqual(await getSource('src_roundtrip_test_000000'), rec)
})

test('registry: plant round-trips and upsert updates in place', async () => {
  await upsertPlant('plt_crud', plant())
  assert.deepEqual(await getPlant('plt_crud'), plant())
  await upsertPlant('plt_crud', plant({ stage: 'flora' }))
  assert.equal((await getPlant('plt_crud'))?.stage, 'flora')
  assert.equal(await getPlant('plt_missing'), null)
})

test('registry: slug resolves through the indirection to the plant', async () => {
  await upsertPlant('plt_slugged', plant({ label: 'Public One' }), 'public-one')
  const hit = await getPlantBySlug('public-one')
  assert.ok(hit, 'claimed slug must resolve')
  assert.equal(hit.plantId, 'plt_slugged')
  assert.equal(hit.plant.label, 'Public One')
  assert.equal(await getPlantBySlug('nobody-here'), null)
})

test('registry: a slug is never stolen by a later plant', async () => {
  await upsertPlant('plt_first', plant(), 'contested')
  await assert.rejects(() => upsertPlant('plt_second', plant(), 'contested'), SlugTakenError)
  // Re-upserting the OWNER with its own slug is an update, not theft.
  await upsertPlant('plt_first', plant({ stage: 'flora' }), 'contested')
  assert.equal((await getPlantBySlug('contested'))?.plantId, 'plt_first')
})

// ── retention split ─────────────────────────────────────────────────────────

test('retention: the branch — unregistered expires, registered survives', async () => {
  assert.equal(await shouldExpire('src_demo_unregistered_00'), true)
  await registerSource('src_registered_plant_000', {
    plant_id: 'plt_retention',
    adapter: 'thcphs-esp32',
    claimed_at: NOW,
  })
  assert.equal(await shouldExpire('src_registered_plant_000'), false)
})

test('retention: memory appends work for both registration states', async () => {
  await registerSource('src_mem_registered_0000', {
    plant_id: 'plt_mem',
    adapter: 'thcphs-esp32',
    claimed_at: NOW,
  })
  assert.equal(await append('src_mem_registered_0000', reading(NOW)), 1)
  assert.equal(await append('src_mem_demo_0000000000', reading(NOW)), 1)
  assert.deepEqual(await readings('src_mem_registered_0000'), [reading(NOW)])
})

test('retention: KV appends EXPIRE demos and PERSIST registered history', async () => {
  process.env.KV_REST_API_URL = 'https://kv.invalid'
  process.env.KV_REST_API_TOKEN = 'test-token'
  const strings = new Map<string, string>()
  const commands: string[][] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    const cmd = (JSON.parse(String(init?.body)) as (string | number)[]).map(String)
    commands.push(cmd)
    let result: unknown = 0
    if (cmd[0] === 'GET') result = strings.get(cmd[1]) ?? null
    else if (cmd[0] === 'SET') {
      strings.set(cmd[1], cmd[2])
      result = 'OK'
    } else if (cmd[0] === 'ZCARD') result = 1
    return new Response(JSON.stringify({ result }), { status: 200 })
  }) as typeof fetch
  try {
    await append('src_kv_demo_unregister00', reading(NOW))
    const demo = commands.map((c) => c[0])
    assert.ok(demo.includes('EXPIRE'), 'demo append must refresh the idle TTL')
    assert.ok(!demo.includes('PERSIST'), 'demo append must not persist anything')
    const expire = commands.find((c) => c[0] === 'EXPIRE')!
    assert.equal(expire[2], String(24 * 60 * 60), 'demo TTL is exactly the 24h it always was')

    await registerSource('src_kv_registered_00000', {
      plant_id: 'plt_kv',
      adapter: 'thcphs-esp32',
      claimed_at: NOW,
    })
    commands.length = 0
    await append('src_kv_registered_00000', reading(NOW))
    const reg = commands.map((c) => c[0])
    assert.ok(!reg.includes('EXPIRE'), 'registered history must never get a TTL')
    assert.ok(
      reg.includes('PERSIST'),
      'a pre-registration TTL must be cleared, not merely not refreshed',
    )
    // The registered check is decided once per append, not once per command.
    assert.equal(
      commands.filter((c) => c[0] === 'GET' && c[1].startsWith('pf:source:')).length,
      1,
      'exactly one registry lookup per append',
    )
  } finally {
    globalThis.fetch = realFetch
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
  }
})

// ── admin mint ──────────────────────────────────────────────────────────────

test('mint: token and plant id formats', () => {
  const t = mintSourceToken()
  assert.match(t, /^src_[0-9a-f]{24}$/)
  assert.notEqual(mintSourceToken(), t, 'two mints must differ')
  assert.match(mintPlantId(), /^plt_[0-9a-f]{16}$/)
})

test('mint body: full body parses; defaults are explicit, not guesses', () => {
  const r = parseMintBody({
    label: 'Thalesadão',
    species: 'cannabis',
    stage: 'vega',
    slug: 'thalesadao',
    adapter: 'thcphs-esp32',
  })
  assert.ok(r.ok, r.ok ? '' : r.error)
  assert.deepEqual(r.body, {
    label: 'Thalesadão',
    species: 'cannabis',
    stage: 'vega',
    slug: 'thalesadao',
    adapter: 'thcphs-esp32',
  })

  const min = parseMintBody({ label: 'X', species: 'fern' })
  assert.ok(min.ok, min.ok ? '' : min.error)
  assert.equal(min.body.stage, null)
  assert.equal(min.body.slug, undefined)
  assert.equal(min.body.adapter, 'unspecified')
})

test('mint body: stage is gated at the mint door, not at judgment', () => {
  // A species that declares the stage mints with it…
  const staged = parseMintBody({ label: 'X', species: 'cannabis', stage: 'vega' })
  assert.ok(staged.ok, staged.ok ? '' : staged.error)
  assert.equal(staged.body.stage, 'vega')

  // …and a stageless species mints fine as long as it asks for none.
  const stageless = parseMintBody({ label: 'Pimenta', species: 'pepper' })
  assert.ok(stageless.ok, stageless.ok ? '' : stageless.error)
  assert.equal(stageless.body.stage, null)

  // pothos+vega used to mint and then detonate later at withStage — now it
  // is refused at THIS door, naming both the stage and the species.
  const wrong = parseMintBody({ label: 'X', species: 'pothos', stage: 'vega' })
  assert.ok(!wrong.ok, 'a stage on a stageless species must not mint')
  assert.ok(wrong.error.includes('vega'), `refusal must name the stage (got: ${wrong.error})`)
  assert.ok(wrong.error.includes('pothos'), `refusal must name the species (got: ${wrong.error})`)

  // An unknown stage on a STAGED species names the stages it does have.
  const typo = parseMintBody({ label: 'X', species: 'cannabis', stage: 'seedling' })
  assert.ok(!typo.ok, 'a stage the species never declared must not mint')
  assert.ok(
    typo.error.includes('seedling') && typo.error.includes('vega') && typo.error.includes('flora'),
    `refusal must name the typo and the real stages (got: ${typo.error})`,
  )
})

test('mint body: refusals name the offending field', () => {
  const cases: [Record<string, unknown> | string, string][] = [
    ['nope', 'object'],
    [{ species: 'pothos' }, 'label'],
    [{ label: '   ', species: 'pothos' }, 'label'],
    [{ label: 'X', species: 'banana' }, 'pothos'], // unknown species names the known ones
    [{ label: 'X' }, 'species'],
    [{ label: 'X', species: 'pothos', stage: '' }, 'stage'],
    [{ label: 'X', species: 'pothos', slug: 'Bad Slug!' }, 'slug'],
    [{ label: 'X', species: 'pothos', slug: '-leading' }, 'slug'],
    [{ label: 'X', species: 'pothos', adapter: '' }, 'adapter'],
    [{ label: 'X', species: 'pothos', vibe: 'good' }, 'vibe'], // unknown field refused by name
  ]
  for (const [body, needle] of cases) {
    const r = parseMintBody(body)
    assert.ok(!r.ok, `${JSON.stringify(body)} must be refused`)
    assert.ok(r.error.includes(needle), `refusal must mention "${needle}" (got: ${r.error})`)
  }
})

test('mint: a device mint creates the plant, claims the slug, registers the source', async () => {
  const r = parseMintBody({ label: 'Minty', species: 'basil', slug: 'minty' })
  assert.ok(r.ok, r.ok ? '' : r.error)
  const { sourceToken, plantId } = await mintDevice(r.body, NOW)
  assert.match(sourceToken, /^src_[0-9a-f]{24}$/)

  assert.deepEqual(await getSource(sourceToken), {
    plant_id: plantId,
    adapter: 'unspecified',
    claimed_at: NOW,
  })
  assert.deepEqual(await getPlant(plantId), {
    label: 'Minty',
    species: 'basil',
    stage: null,
    sources: [sourceToken],
    public: false,
  })
  assert.equal((await getPlantBySlug('minty'))?.plantId, plantId)
  // The point of it all: a minted token's history no longer evaporates.
  assert.equal(await shouldExpire(sourceToken), false)
})

// ── public flip ─────────────────────────────────────────────────────────────

test('flip body: exactly plant_id + public parses, nothing added', () => {
  const r = parsePatchBody({ plant_id: 'plt_0011223344556677', public: true })
  assert.ok(r.ok, r.ok ? '' : r.error)
  assert.deepEqual(r.body, { plant_id: 'plt_0011223344556677', public: true })
})

test('flip body: refusals name the offending field, look-alikes not coerced', () => {
  const cases: [Record<string, unknown> | string, string][] = [
    ['nope', 'object'],
    [{ public: true }, 'plant_id'], // missing
    [{ plant_id: 'plt_x' }, 'public'], // missing
    [{ plant_id: 42, public: true }, 'plant_id'], // wrong type
    [{ plant_id: '   ', public: true }, 'plant_id'], // blank is not an id
    [{ plant_id: 'plt_x', public: 'true' }, 'public'], // string, not boolean
    [{ plant_id: 'plt_x', public: 1 }, 'public'], // truthy, not true
    [{ plant_id: 'plt_x', public: true, slug: 'sneaky' }, 'slug'], // unknown field by name
  ]
  for (const [body, needle] of cases) {
    const r = parsePatchBody(body)
    assert.ok(!r.ok, `${JSON.stringify(body)} must be refused`)
    assert.ok(r.error.includes(needle), `refusal must mention "${needle}" (got: ${r.error})`)
  }
})

test('flip: false→true→false round-trips and touches nothing else', async () => {
  const minted = parseMintBody({ label: 'Flippy', species: 'pepper', slug: 'flippy' })
  assert.ok(minted.ok, minted.ok ? '' : minted.error)
  const { plantId, sourceToken } = await mintDevice(minted.body, NOW)
  assert.equal((await getPlant(plantId))?.public, false, 'plants are born private')

  const published = await applyPublicFlip({ plant_id: plantId, public: true })
  assert.equal(published?.public, true)
  assert.equal((await getPlant(plantId))?.public, true, 'the flip must reach the registry')

  const unpublished = await applyPublicFlip({ plant_id: plantId, public: false })
  assert.equal(unpublished?.public, false)
  // Everything except the bit survives the round trip verbatim.
  assert.deepEqual(await getPlant(plantId), {
    label: 'Flippy',
    species: 'pepper',
    stage: null,
    sources: [sourceToken],
    public: false,
  })
  // The slug still resolves — a flip must never disturb the public name.
  assert.equal((await getPlantBySlug('flippy'))?.plantId, plantId)
})

test('flip: an unknown plant is refused, never upserted into existence', async () => {
  assert.equal(await applyPublicFlip({ plant_id: 'plt_never_minted_000', public: true }), null)
  assert.equal(await getPlant('plt_never_minted_000'), null, 'the flip must not create a row')
})
