// Durable archive — plain Postgres behind the ingest door.
// (Lives on the Oracle "plant-faces" box; any Postgres reachable from the
// deploy works — the driver is standard node-postgres, nothing vendor-shaped.)
//
// The KV window is a demo pane: 24h TTL for unregistered tokens, a hot-window
// cap for everyone. The archive is the scientific record: every validated
// envelope lands as one immutable row in raw_readings, keyed
// UNIQUE(source_token, ts) so a retrying node is idempotent, never
// double-counted. When ARCHIVE_DATABASE_URL is set the archive is
// AUTHORITATIVE: an insert failure refuses the whole ingest (503 in the route)
// even though the KV path would have succeeded — a reading that reaches only
// the 24h demo store is on a conveyor belt into the incinerator. When the env
// is unset the archive does not exist and ingest behaves exactly as before.
//
// Talks to Postgres over node-postgres (pg), imported lazily so archive-less
// deploys and the test suite never load it.
// Tests inject a scripted client through setSqlClientForTests — the same
// spirit as the scripted fetch that plays Upstash in store-registry.test.ts.
//
// The schema lives twice on purpose: ARCHIVE_DDL here (what ensureSchema
// runs) and lib/archive.sql checked in for humans and psql. A test pins the
// two byte-identical so they cannot drift apart.

import type { Envelope } from './ingest.ts'

/** Kept byte-identical to lib/archive.sql — archive.test.ts enforces it. */
export const ARCHIVE_DDL = `create table if not exists raw_readings (
  id bigserial primary key,
  source_token text not null,
  ts bigint not null,
  channels jsonb not null,
  meta jsonb,
  raw jsonb not null,
  received_at timestamptz default now(),
  unique (source_token, ts)
);`

const INSERT_READING = `insert into raw_readings (source_token, ts, channels, meta, raw)
values ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb)
on conflict (source_token, ts) do nothing`

/** One parameterized statement against the archive. Rows back, or throws. */
export type ArchiveSqlClient = (text: string, params?: unknown[]) => Promise<unknown>

let testClient: ArchiveSqlClient | null = null
let pgClient: { url: string; run: ArchiveSqlClient } | null = null
let schemaReady: Promise<void> | null = null

/**
 * Swap the real driver for a scripted one. Passing null restores it. Either
 * way the schema memo resets: an injected client is a fresh database, and a
 * test must never inherit another test's "already created the table" state.
 */
export function setSqlClientForTests(client: ArchiveSqlClient | null): void {
  testClient = client
  pgClient = null
  schemaReady = null
}

export const archiveEnabled = (): boolean => Boolean(process.env.ARCHIVE_DATABASE_URL)

async function sqlClient(): Promise<ArchiveSqlClient> {
  if (testClient) return testClient
  const url = process.env.ARCHIVE_DATABASE_URL
  if (!url) {
    // Same honesty rule as storeMode(): misconfiguration must say so, never
    // behave. Callers gate on archiveEnabled(); reaching here without the env
    // is a bug worth hearing about, not worth papering over.
    throw new Error('archive misconfigured: ARCHIVE_DATABASE_URL is not set')
  }
  if (pgClient?.url !== url) {
    const { Pool } = await import('pg')
    // sslmode in the URL means "encrypt". The box serves a self-signed cert,
    // so verification is off for now — encrypted but unpinned. Upgrading to
    // verify-full (pinned CA in ARCHIVE_DATABASE_CA) is the documented next
    // step once a real cert lands; never silently downgrade back.
    //
    // The param is stripped before pg sees it: pg's own sslmode parsing
    // enforces CA verification (DEPTH_ZERO_SELF_SIGNED_CERT against this box)
    // and its semantics are slated to change in pg v9 — owning the ssl object
    // here keeps the behavior explicit and stable across driver upgrades.
    const u = new URL(url)
    const sslRequested = u.searchParams.has('sslmode')
    u.searchParams.delete('sslmode')
    const pool = new Pool({
      connectionString: u.toString(),
      max: 3,
      ssl: sslRequested ? { rejectUnauthorized: false } : undefined,
    })
    pgClient = {
      url,
      run: async (text, params) => (await pool.query(text, params as unknown[])).rows,
    }
  }
  return pgClient.run
}

/** Create the raw_readings table if it is not there. Safe to run repeatedly. */
export async function ensureSchema(): Promise<void> {
  const sql = await sqlClient()
  await sql(ARCHIVE_DDL)
}

/**
 * ensureSchema, once per process — reading #1 after a cold start must survive
 * without a manual migration step. A FAILED ensure is not remembered as
 * success: the memo clears so the next reading retries the DDL instead of
 * inserting into a table that may not exist.
 */
function schemaOnce(): Promise<void> {
  if (!schemaReady) {
    schemaReady = ensureSchema().catch((e) => {
      schemaReady = null
      throw e
    })
  }
  return schemaReady
}

/**
 * Archive one validated envelope. `rawBody` is the request body TEXT, stored
 * verbatim in the raw column — the audit trail keeps what the source actually
 * sent, not a re-serialized paraphrase. Duplicate (source_token, ts) is a
 * no-op by construction (ON CONFLICT DO NOTHING): a node retrying a POST it
 * never saw the 202 for must not error and must not double-count.
 */
export async function archiveReading(env: Envelope, rawBody: string): Promise<void> {
  await schemaOnce()
  const sql = await sqlClient()
  await sql(INSERT_READING, [
    env.sourceToken,
    env.ts,
    JSON.stringify(env.channels),
    JSON.stringify(env.meta),
    rawBody,
  ])
}

/**
 * The route's one call. Env unset → { archived: false } without touching any
 * client — behavior byte-identical to an archive-less deploy. Env set → the
 * reading is archived or the error propagates for the route to refuse with
 * 503; there is no third outcome where ingest quietly proceeds un-archived.
 */
export async function archiveIfEnabled(
  env: Envelope,
  rawBody: string,
): Promise<{ archived: boolean }> {
  if (!archiveEnabled()) return { archived: false }
  await archiveReading(env, rawBody)
  return { archived: true }
}
