// Reconcile the KV hot window against the Neon archive for one source token.
// The archive is authoritative, so the only diff that matters is readings the
// KV window holds that the archive does NOT — each one is a reading on the
// conveyor belt into the incinerator (24h TTL / hot-window cap).
//
// Usage:
//   DEVICE_TOKEN=src_... ARCHIVE_DATABASE_URL=postgres://... \
//     node scripts/reconcile.mjs [--backfill] [base-url]
//
// base-url defaults to http://localhost:3000. Exit 1 when readings are
// missing from the archive and left un-backfilled, 0 otherwise.
//
// Honesty note on --backfill: /api/readings exposes the FULL reading only for
// `latest`; historical series points carry moisture + ec alone. A backfilled
// historical row therefore holds exactly the channels the API actually
// reported — flagged meta.ingest_source='backfill', with the API row verbatim
// in the raw column — and never invents soil_temp/ph values the endpoint did
// not return.

import { readFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'

const token = process.env.DEVICE_TOKEN
const dbUrl = process.env.ARCHIVE_DATABASE_URL
if (!token || !dbUrl) {
  console.error('refusing to run: DEVICE_TOKEN and ARCHIVE_DATABASE_URL must both be set')
  process.exit(1)
}

const args = process.argv.slice(2)
const backfill = args.includes('--backfill')
const base = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3000'

// ── KV side, through the public read seam ───────────────────────────────────

const res = await fetch(`${base}/api/readings?device_token=${encodeURIComponent(token)}`)
if (!res.ok) {
  console.error(`refusing to diff: ${base}/api/readings answered ${res.status} ${await res.text()}`)
  process.exit(1)
}
const body = await res.json()

// ts → the channels the API actually exposed for that reading, plus the API
// row itself for the raw column. `latest` overwrites its series point with
// the full four-channel reading.
const kvRows = new Map()
for (const p of body.series ?? []) {
  kvRows.set(p.ts, {
    channels: { soil_moisture_pct: p.moisture, soil_ec_ms_cm: p.ec },
    raw: p,
  })
}
if (body.latest) {
  const l = body.latest
  kvRows.set(l.ts, {
    channels: {
      soil_moisture_pct: l.moisture,
      soil_temp_c: l.soilTemp,
      soil_ec_ms_cm: l.ec,
      soil_ph: l.ph,
    },
    raw: l,
  })
}

// ── archive side ────────────────────────────────────────────────────────────

const sql = neon(dbUrl)
// The driver returns bigint columns as strings; ts fits in a JS number.
const archiveTs = new Set(
  (await sql.query('select ts from raw_readings where source_token = $1', [token])).map((r) =>
    Number(r.ts),
  ),
)

const missing = [...kvRows.keys()].filter((ts) => !archiveTs.has(ts)).sort((a, b) => a - b)
const archiveOnly = archiveTs.size - (kvRows.size - missing.length)

console.log(`source ${token}: KV window ${kvRows.size} readings, archive ${archiveTs.size} rows`)
console.log(
  `archive-only rows (aged out of the KV window — expected, not an error): ${archiveOnly}`,
)
console.log(`missing in archive: ${missing.length}`)
for (const ts of missing) {
  const partial = kvRows.get(ts).channels.soil_ph === undefined ? ' (moisture+ec only)' : ''
  console.log(`  ${ts}  ${new Date(ts).toISOString()}${partial}`)
}

if (missing.length === 0) {
  console.log('archive ⊇ KV window — nothing to do')
  process.exit(0)
}

if (!backfill) {
  console.log('re-run with --backfill to insert the missing rows')
  process.exit(1)
}

// ── backfill ────────────────────────────────────────────────────────────────

// Same DDL the app runs; the checked-in file is the human-facing copy.
await sql.query(readFileSync(new URL('../lib/archive.sql', import.meta.url), 'utf8'))
for (const ts of missing) {
  const row = kvRows.get(ts)
  await sql.query(
    `insert into raw_readings (source_token, ts, channels, meta, raw)
values ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb)
on conflict (source_token, ts) do nothing`,
    [
      token,
      ts,
      JSON.stringify(row.channels),
      JSON.stringify({ ingest_source: 'backfill' }),
      JSON.stringify(row.raw),
    ],
  )
}
console.log(`backfilled ${missing.length} rows (meta.ingest_source='backfill')`)
