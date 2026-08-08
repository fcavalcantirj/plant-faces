// Run: pnpm test
//
// The Neon archive seam. No live database here — a scripted client stands in
// for the driver (the same spirit as the scripted fetch that plays Upstash in
// store-registry.test.ts), recording every statement so the suite can pin the
// four semantics the route depends on: env unset → untouched, failure →
// propagates (the route's 503), duplicate → idempotent by construction, raw
// body → verbatim. The live 3-curls check against a real Neon DB is a
// separate, deliberately manual step.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  archiveEnabled,
  archiveIfEnabled,
  archiveReading,
  ensureSchema,
  setSqlClientForTests,
  ARCHIVE_DDL,
  type ArchiveSqlClient,
} from './archive.ts'
import type { Envelope } from './ingest.ts'

// Archive env leaking in from the shell would silently point these at a real
// database — strip it up front, exactly as the store suite strips KV.
delete process.env.ARCHIVE_DATABASE_URL

const NOW = 1_754_650_000_000

const envelope = (over: Partial<Envelope> = {}): Envelope => ({
  sourceToken: 'src_archive_test_00000000',
  ts: NOW,
  channels: { soil_moisture_pct: 42.1, soil_temp_c: 22.4, soil_ec_ms_cm: 1.15, soil_ph: 6.3 },
  meta: { adapter: 'thcphs-esp32' },
  ...over,
})

/** A scripted client: records calls, answers per-call from an optional plan. */
function scripted(plan: Array<'ok' | Error> = []) {
  const calls: { text: string; params?: unknown[] }[] = []
  const client: ArchiveSqlClient = async (text, params) => {
    calls.push({ text, params })
    const step = plan.shift() ?? 'ok'
    if (step instanceof Error) throw step
    return []
  }
  return { calls, client }
}

/** Run fn with the scripted client injected and the archive env set. */
async function withArchive<T>(
  calls: { client: ArchiveSqlClient },
  fn: () => Promise<T>,
): Promise<T> {
  process.env.ARCHIVE_DATABASE_URL = 'postgresql://scripted.invalid/neondb'
  setSqlClientForTests(calls.client)
  try {
    return await fn()
  } finally {
    setSqlClientForTests(null)
    delete process.env.ARCHIVE_DATABASE_URL
  }
}

// ── schema ──────────────────────────────────────────────────────────────────

test('schema: the checked-in archive.sql and ARCHIVE_DDL cannot drift', () => {
  const file = readFileSync(new URL('./archive.sql', import.meta.url), 'utf8')
  assert.equal(file, ARCHIVE_DDL + '\n')
  // The two clauses the whole design leans on.
  assert.ok(ARCHIVE_DDL.includes('unique (source_token, ts)'), 'idempotency key must be declared')
  assert.ok(ARCHIVE_DDL.includes('raw jsonb not null'), 'the audit column must be mandatory')
})

test('schema: ensureSchema runs the DDL through the client', async () => {
  const s = scripted()
  await withArchive(s, () => ensureSchema())
  assert.equal(s.calls.length, 1)
  assert.equal(s.calls[0].text, ARCHIVE_DDL)
})

test('schema: ensured lazily once per client, retried after a failure', async () => {
  const s = scripted()
  await withArchive(s, async () => {
    await archiveReading(envelope(), '{}')
    await archiveReading(envelope({ ts: NOW + 1 }), '{}')
  })
  // DDL once, then one insert per reading — never DDL per reading.
  assert.deepEqual(
    s.calls.map((c) => (c.text === ARCHIVE_DDL ? 'ddl' : 'insert')),
    ['ddl', 'insert', 'insert'],
  )

  // A failed ensure must not be remembered as success: the next reading
  // retries the DDL instead of inserting into a table that may not exist.
  const flaky = scripted([new Error('relation service unavailable')])
  await withArchive(flaky, async () => {
    await assert.rejects(() => archiveReading(envelope(), '{}'), /service unavailable/)
    await archiveReading(envelope(), '{}')
  })
  assert.deepEqual(
    flaky.calls.map((c) => (c.text === ARCHIVE_DDL ? 'ddl' : 'insert')),
    ['ddl', 'ddl', 'insert'],
  )
})

// ── the four route semantics ────────────────────────────────────────────────

test('env unset: archive skipped entirely — archived:false, no client call', async () => {
  assert.equal(archiveEnabled(), false)
  const s = scripted()
  // Client injected but env unset: archiveIfEnabled must not even look at it.
  setSqlClientForTests(s.client)
  try {
    assert.deepEqual(await archiveIfEnabled(envelope(), '{}'), { archived: false })
    assert.equal(s.calls.length, 0, 'a disabled archive must touch nothing')
  } finally {
    setSqlClientForTests(null)
  }
})

test('env set: archived:true after the insert lands', async () => {
  const s = scripted()
  const out = await withArchive(s, () => archiveIfEnabled(envelope(), '{"x":1}'))
  assert.deepEqual(out, { archived: true })
  assert.equal(s.calls.length, 2, 'ddl + insert')
})

test('archive failure propagates — the route turns it into the 503', async () => {
  // Ensure succeeds, the insert dies: the reading must NOT quietly proceed to
  // KV-only storage — archiveIfEnabled rejects and the route refuses with 503.
  const s = scripted(['ok', new Error('connection refused')])
  await withArchive(s, async () => {
    await assert.rejects(() => archiveIfEnabled(envelope(), '{}'), /connection refused/)
  })
})

test('duplicate (source_token, ts): idempotent by construction', async () => {
  const s = scripted()
  await withArchive(s, async () => {
    await archiveReading(envelope(), '{"retry":1}')
    await archiveReading(envelope(), '{"retry":2}')
  })
  const inserts = s.calls.filter((c) => c.text !== ARCHIVE_DDL)
  assert.equal(inserts.length, 2, 'a retry reaches the database — the conflict clause absorbs it')
  for (const ins of inserts) {
    assert.ok(
      ins.text.includes('on conflict (source_token, ts) do nothing'),
      'the insert must carry the idempotency clause, not hope',
    )
    assert.deepEqual(
      [ins.params?.[0], ins.params?.[1]],
      ['src_archive_test_00000000', NOW],
      'both retries target the same (source_token, ts) key',
    )
  }
})

test('raw body: stored verbatim, not re-serialized', async () => {
  // Deliberately odd spacing and key order — a paraphrase would normalize it.
  const wire = '{ "ts": 1754650000000,\n  "device_token": "dev-abc123",  "ph": 6.3,' +
    ' "moisture": 42.1, "soil_temp": 22.4, "ec": 1.15 }'
  const s = scripted()
  await withArchive(s, () => archiveReading(envelope(), wire))
  const ins = s.calls.find((c) => c.text !== ARCHIVE_DDL)!
  assert.equal(ins.params?.[4], wire, 'the raw column gets the exact bytes the source posted')
  // The structured columns beside it carry the validated envelope.
  assert.deepEqual(JSON.parse(ins.params?.[2] as string), envelope().channels)
  assert.deepEqual(JSON.parse(ins.params?.[3] as string), envelope().meta)
})

// ── misconfiguration ────────────────────────────────────────────────────────

test('no env, no injected client: archiveReading refuses by name', async () => {
  setSqlClientForTests(null)
  await assert.rejects(() => archiveReading(envelope(), '{}'), /ARCHIVE_DATABASE_URL/)
})
