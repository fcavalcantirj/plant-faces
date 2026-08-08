#!/usr/bin/env node
// plant — the deterministic read-only CLI the plant agent calls (T3.2).
//
// The agent's hands, not its brain. Every command is ONE GET against the web
// app's /api/readings and a faithful printout of what the server answered:
// no scoring, no recomputation, no defaults for missing numbers. The mood
// engine lives server-side (web/lib/plant-mood.ts, web/lib/stats.ts) and this
// file is allowed to FORMAT its output and nothing more — so every number the
// persona quotes can be traced to a server response, digit for digit.
//
//   plant.mjs status            ?latest=1 — verdict, latest reading, recent events
//   plant.mjs history [--hours N]  full payload, sliced client-side by ts alone
//   plant.mjs care              the server-inferred care events (water/feed)
//   plant.mjs profile           which species profile judged the verdict
//   plant.mjs stats             ?stats=1 — time-in-band tallies + streaks
//   plant.mjs climate           alias of stats for now — see the TODO below
//
// Env: PLANT_API_URL (default http://localhost:3000), PLANT_DEVICE_TOKEN
// (required — a CLI that invents a token would be quoting nobody's plant),
// PLANT_SPECIES (optional ?species= knob — steers UNREGISTERED demo tokens
// only; the server ignores it for registered sources, which are judged as
// their plant).
//
// --json prints the server body verbatim: raw passthrough, no slicing, no
// selection. API unreachable or non-200 → explicit error on stderr, exit 1 —
// NEVER a guessed value. Node 22 builtins only; no dependencies.

const API = process.env.PLANT_API_URL ?? 'http://localhost:3000'
const TOKEN = process.env.PLANT_DEVICE_TOKEN
const SPECIES = process.env.PLANT_SPECIES

const COMMANDS = ['status', 'history', 'care', 'profile', 'stats', 'climate']

const USAGE = `usage: plant.mjs <${COMMANDS.join('|')}> [--hours N] [--json]

env: PLANT_API_URL (default http://localhost:3000)
     PLANT_DEVICE_TOKEN (required)
     PLANT_SPECIES (optional — steers unregistered demo tokens only)`

function fail(msg) {
  process.stderr.write(`plant: ${msg}\n`)
  process.exit(1)
}

// ── argument parsing — refuse unknowns, never guess ─────────────────────────

const argv = process.argv.slice(2)
const cmd = argv[0]
let hours = 24
let rawJson = false
for (let i = 1; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--json') rawJson = true
  else if (a === '--hours') {
    const n = Number(argv[++i])
    if (!Number.isFinite(n) || n <= 0) fail(`--hours needs a positive number, got "${argv[i]}"`)
    hours = n
  } else fail(`unknown argument "${a}"\n${USAGE}`)
}
if (!cmd || !COMMANDS.includes(cmd)) {
  process.stderr.write(`${USAGE}\n`)
  process.exit(1)
}
if (!TOKEN) fail('PLANT_DEVICE_TOKEN is not set — refusing to invent a token')

// ── the one fetch — every command is a different /api/readings query ────────

function queryFor(command) {
  const q = new URLSearchParams({ device_token: TOKEN })
  if (SPECIES) q.set('species', SPECIES)
  switch (command) {
    case 'status':
    case 'profile':
      q.set('latest', '1')
      break
    case 'stats':
    case 'climate':
      // latest=1 keeps the payload compact; stats rides along on either shape.
      q.set('latest', '1')
      q.set('stats', '1')
      break
    // history and care need the full payload: the series and the whole event
    // list only exist there.
  }
  return q
}

async function fetchReadings(command) {
  const url = `${API}/api/readings?${queryFor(command)}`
  let res
  try {
    res = await fetch(url)
  } catch (e) {
    fail(`GET ${url} unreachable: ${e.cause?.code ?? e.cause?.message ?? e.message}`)
  }
  const text = await res.text()
  if (!res.ok) fail(`GET ${url} answered ${res.status}: ${text}`)
  let body
  try {
    body = JSON.parse(text)
  } catch {
    fail(`GET ${url} answered non-JSON: ${text.slice(0, 200)}`)
  }
  return { text, body }
}

// ── renderings — fixed text that quotes the server's numbers verbatim ───────

const iso = (ts) => new Date(ts).toISOString()

function renderStatus(b) {
  if (!b.paired) return `unpaired: no readings stored for this token (profile ${b.profile})`
  const m = b.mood
  const l = b.latest
  const lines = [
    `[${b.profile}] ${m.emotion} — "${m.headline}"`,
    `wellbeing: ${m.wellbeing}/100  comfort: ${m.comfort}`,
    `latest @ ${iso(l.ts)}: moisture ${l.moisture}%  soilTemp ${l.soilTemp}°C  ec ${l.ec} mS/cm  ph ${l.ph}`,
    `reason: ${m.reason}`,
  ]
  if (m.notes.length > 0) lines.push(`notes: ${m.notes.join(' | ')}`)
  lines.push(
    `events (recent): ${b.events.length === 0 ? 'none' : b.events.map((e) => `${e.kind}@${iso(e.ts)}`).join('  ')}`,
    `readings stored: ${b.count}`,
  )
  return lines.join('\n')
}

function renderCare(b) {
  if (!b.paired) return `unpaired: no readings stored for this token (profile ${b.profile})`
  if (b.events.length === 0) return `no care events inferred from ${b.count} stored readings`
  const lines = b.events.map((e) => `${e.kind.padEnd(5)}  ${iso(e.ts)}  (ts ${e.ts})`)
  lines.push(`events: ${b.events.length} across ${b.count} stored readings`)
  return lines.join('\n')
}

// The plant agent's tool contract (plan T3.2): print server JSON pretty for
// the structured commands. JSON.stringify re-serializes the parsed values —
// numerically identical, which is what "verbatim" must mean for a number.
const pretty = (obj) => JSON.stringify(obj, null, 2)

async function main() {
  const { text, body } = await fetchReadings(cmd)

  // Raw passthrough: the body exactly as the server sent it, unsliced.
  if (rawJson) {
    process.stdout.write(text.endsWith('\n') ? text : `${text}\n`)
    return
  }

  switch (cmd) {
    case 'status':
      console.log(renderStatus(body))
      break

    case 'history': {
      // Client-side slice by ts ONLY — a subset of the server's own points,
      // never a recomputation. The cutoff clock is this machine's wall time,
      // which is fine for a window; the points themselves are untouched.
      const cutoff = Date.now() - hours * 3_600_000
      console.log(
        pretty({
          profile: body.profile,
          paired: body.paired,
          window_hours: hours,
          count_total: body.count,
          series: (body.series ?? []).filter((p) => p.ts >= cutoff),
          events: (body.events ?? []).filter((e) => e.ts >= cutoff),
        }),
      )
      break
    }

    case 'care':
      console.log(renderCare(body))
      break

    case 'profile':
      // The server names the profile that judged the verdict; the knob we may
      // have sent is echoed so the agent can tell steering from judgment.
      console.log(
        pretty({
          profile: body.profile,
          paired: body.paired,
          species_param_sent: SPECIES ?? null,
        }),
      )
      break

    case 'climate':
      // TODO(home-air-source): no air source exists at home yet — air_temp_c /
      // rh_pct are unmeasured, so there is no climate to report. Until the
      // Tuya/SHT4x adapter lands (plan T0.12 / WAVE 4), this command is an
      // honest alias of `stats`: the note below says so instead of inventing
      // a VPD from nothing.
      console.log(
        'climate: TODO — no air source at home yet (air_temp_c / rh_pct unmeasured); showing the soil stats tally instead.',
      )
    // fall through
    case 'stats':
      if (!body.stats) fail('server response carries no stats field — is ?stats=1 supported on this deploy?')
      console.log(pretty({ profile: body.profile, paired: body.paired, ...body.stats }))
      break
  }
}

await main()
