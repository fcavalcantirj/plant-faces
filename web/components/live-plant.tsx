'use client'

// The LIVE plant page's HUD — the simulator's visual language with every
// lever removed.
//
// /p/[slug] is where a REAL plant gets looked at, so this file is the
// doctrine made structural: THERE ARE NO BUTTONS. The simulator's HUD
// (plant-hud.tsx) draws a dashed line between "the app" (reads) and "the
// room" (moves the world the probe reads); this page is the app half only —
// duplicated, not imported, because plant-hud.tsx keeps its scaffolding until
// real hardware deletes it, and a live page must not ship water buttons, even
// dead ones. Everything on screen was computed by the server from stored
// readings; refresh this page all day and the plant will not get one point
// happier. Only the soil can.
//
// Two modes, decided by the URL (app/p/[slug]/page.tsx):
//   owner  — ?device_token=src_… polls /api/readings?latest=1&stats=1
//   public — no token, polls /api/public/[slug]'s seven whitelisted fields
//
// Both poll every POLL_MS and render whatever verdict arrives. Staleness is
// the SERVER's call (the wall clock in /api/readings) — a silent probe comes
// back as `glitch` in the payload, and this page just wears the face it is
// handed. A network blink on OUR side is not a verdict, so a failed poll
// keeps the last truth instead of inventing an alarm.

import { useEffect, useMemo, useState } from 'react'
import { AgentFace } from '@/components/agent-face'
import { EMOTION_META, type Emotion } from '@/lib/face-points'
import type { LatestPayload, PublicProjection, LastSeenBucket } from '@/lib/derive'
import type { PlantStats } from '@/lib/stats'
import { axisValue, type CareEvent, type MoodResult } from '@/lib/plant-mood'
import { speciesById, withStage, type AxisSpec } from '@/lib/species'

/**
 * A real node posts every 15 minutes; asking every minute is already generous.
 * The face checks in on a human cadence, not a trading-floor one.
 */
const POLL_MS = 60_000

/**
 * The boot state, before the first poll has answered — same philosophy as the
 * simulator's BOOTING constant (app/page.tsx): `glitch` is an ALARM that means
 * the probe went silent, and an alarm that fires on every page load is an
 * alarm people learn to ignore. "I have not asked yet" is not "the probe is
 * dead" — say the true thing.
 */
const BOOTING: MoodResult = {
  emotion: 'neutral',
  wellbeing: 0,
  comfort: 0,
  headline: 'Waking up…',
  reason: 'Asking the server what the soil said.',
  notes: [],
}

/** A token the store has never heard from. Not an alarm either — an absence. */
const NOTHING_YET: MoodResult = {
  emotion: 'neutral',
  wellbeing: 0,
  comfort: 0,
  headline: 'Nobody has spoken for me yet.',
  reason: 'No readings stored for this token — the probe has not posted, or this is not its token.',
  notes: [],
}

// ── shared read-only pieces ─────────────────────────────────────────────────

/**
 * The page chrome every state shares: face, scanlines, header. Duplicates the
 * simulator's frame (app/page.tsx + plant-hud.tsx header) on purpose — small
 * read-only pieces are copied rather than refactored out of the simulator,
 * because this wave is additive and the simulator dies its own death later.
 */
function Frame({
  emotion,
  title,
  sub,
  badge,
  children,
}: {
  emotion: Emotion
  title: string
  sub: string
  badge: string
  children: React.ReactNode
}) {
  const hex = EMOTION_META[emotion].hex
  return (
    <main className="relative h-screen w-full overflow-hidden bg-background">
      <h1 className="sr-only">{title}</h1>
      <AgentFace emotion={emotion} />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'repeating-linear-gradient(0deg, rgba(0,0,0,0.12) 0px, rgba(0,0,0,0.12) 1px, transparent 1px, transparent 3px), radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)',
        }}
      />
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between font-mono">
        <header className="flex items-start justify-between border-b border-border/60 px-4 py-3 md:px-6">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-bold tracking-widest text-foreground">
              PLANT<span style={{ color: hex }}>FACES</span>
            </span>
            <span className="text-[10px] tracking-wider text-muted-foreground">{sub}</span>
          </div>
          <div className="flex flex-col items-end gap-1 pt-1">
            <div className="flex items-center gap-2">
              <span
                className="h-1.5 w-1.5 animate-pulse rounded-full"
                style={{ backgroundColor: hex }}
                aria-hidden="true"
              />
              <span className="text-[10px] tracking-widest" style={{ color: hex }}>
                {EMOTION_META[emotion].label}
              </span>
            </div>
            <span className="text-[10px] tracking-wider text-muted-foreground/50">{badge}</span>
          </div>
        </header>
        {children}
      </div>
    </main>
  )
}

/** What the plant is saying. Left gutter, centred — never across the mouth. */
function Quote({
  headline,
  reason,
  notes = [],
  hex,
}: {
  headline: string
  reason?: string
  notes?: string[]
  hex: string
}) {
  return (
    <div className="pointer-events-none flex flex-1 items-center px-4 md:px-6">
      <div className="flex max-w-[15rem] flex-col gap-2 md:max-w-xs">
        <p
          className="text-xl leading-snug tracking-wide md:text-2xl"
          style={{ color: hex, textShadow: `0 0 18px ${hex}66` }}
        >
          &ldquo;{headline}&rdquo;
        </p>
        {reason && (
          <p className="text-[11px] leading-relaxed tracking-wider text-muted-foreground">
            {reason}
          </p>
        )}
        {notes.map((n) => (
          <p key={n} className="text-[10px] leading-relaxed tracking-wider text-muted-foreground/40">
            ⌇ {n}
          </p>
        ))}
      </div>
    </div>
  )
}

/**
 * A reading bar with the species' comfortable band behind the needle.
 * Duplicated from plant-hud.tsx verbatim — see the file comment for why the
 * simulator's HUD is copied from, never imported.
 */
function Gauge({ axis, value, hex }: { axis: AxisSpec; value: number; hex: string }) {
  const { min, max } = axis.display
  const pct = (v: number) => ((v - min) / (max - min)) * 100
  const inBand = value >= axis.band.min && value <= axis.band.max
  const dim = axis.trendOnly
  const color = dim ? '#8b93a7' : inBand ? hex : '#ff6b5e'
  const decimals = axis.key === 'ec' || axis.key === 'ph' ? 2 : 0

  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-[10px] tracking-wider">
        <span className="flex items-center gap-1.5 text-muted-foreground/60">
          {axis.label}
          {axis.trendOnly && (
            <span className="rounded-sm bg-white/8 px-1 text-[8px] text-muted-foreground/50">
              TREND ONLY
            </span>
          )}
          {axis.uncalibrated && !axis.trendOnly && (
            <span className="text-[8px] text-amber-300/40">UNCAL</span>
          )}
        </span>
        <span style={{ color }}>
          {value.toFixed(decimals)}
          {axis.unit}
        </span>
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-sm bg-white/8">
        <div
          className="absolute inset-y-0 bg-white/15"
          style={{
            left: `${Math.max(0, pct(axis.band.min))}%`,
            width: `${Math.min(100, pct(axis.band.max)) - Math.max(0, pct(axis.band.min))}%`,
          }}
        />
        <div
          className="absolute inset-y-0 w-[2px] rounded-sm transition-[left] duration-500"
          style={{
            left: `${Math.min(99, Math.max(0, pct(value)))}%`,
            backgroundColor: color,
            boxShadow: dim ? undefined : `0 0 6px ${color}`,
          }}
        />
      </div>
    </div>
  )
}

/** The slow number and its bar — plus whatever honesty note the mode owes. */
function Wellbeing({ value, hex, note }: { value: number; hex: string; note: React.ReactNode }) {
  return (
    <>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] tracking-widest text-muted-foreground/60">WELLBEING</span>
        <span className="text-base tracking-widest" style={{ color: hex }}>
          {value.toFixed(0)}
          <span className="text-[11px] text-muted-foreground/50">/100</span>
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-sm bg-white/8">
        <div
          className="h-full rounded-sm transition-[width] duration-700"
          style={{ width: `${value}%`, backgroundColor: hex, boxShadow: `0 0 10px ${hex}` }}
        />
      </div>
      <p className="text-right text-[10px] leading-relaxed tracking-wider text-muted-foreground/50">
        {note}
      </p>
    </>
  )
}

/** Coarse, human recency for the care line. */
function ago(ms: number): string {
  if (ms < 60_000) return 'JUST NOW'
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}M AGO`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}H AGO`
  return `${Math.floor(ms / 86_400_000)}D AGO`
}

/**
 * The care record as one line. The compact poll carries recent events only
 * and no series — a page asking "how are you" every minute must not drag two
 * weeks of curve with it — so the sparkline's job is done here in words.
 */
function careLine(events: CareEvent[], now: number): string {
  if (events.length === 0) return 'NO CARE WITNESSED YET — THE SOIL IS TAKING NOTES'
  const water = events.filter((e) => e.kind === 'water').length
  const feed = events.length - water
  const last = events[events.length - 1]
  return `RECENTLY: WATERED ×${water} · FED ×${feed} — LAST ${
    last.kind === 'water' ? 'WATERED' : 'FED'
  } ${ago(now - last.ts)}`
}

// ── owner mode ──────────────────────────────────────────────────────────────

type OwnerPayload = LatestPayload & { stats?: PlantStats }

/**
 * The keeper's page: the token unlocks the full compact payload — verdict,
 * latest reading, recent events, the Thales-style tallies — and unlocks
 * nothing else. The slug in the URL is only the page's name; the token is the
 * identity, exactly as at the ingest door.
 */
export function OwnerPlant({ slug, deviceToken }: { slug: string; deviceToken: string }) {
  const [data, setData] = useState<OwnerPayload | null>(null)

  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const res = await fetch(
          `/api/readings?device_token=${encodeURIComponent(deviceToken)}&latest=1&stats=1`,
          { cache: 'no-store' },
        )
        if (!res.ok) return // the server said no; keep the last truth we had
        const body = (await res.json()) as OwnerPayload
        if (alive) setData(body)
      } catch {
        // A failed fetch is OUR outage, not the plant's. The server's wall
        // clock is what turns real silence into `glitch`.
      }
    }
    void poll()
    const id = setInterval(() => void poll(), POLL_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [deviceToken])

  // The species that judged this token, per the server; the stage rides in on
  // the stats payload. Server and client share lib/species.ts in one build,
  // and the server already refused any unknown stage at the mint — so this
  // withStage call is replaying a validated pair, not guessing.
  const profile = useMemo(() => {
    const base = speciesById(data?.profile ?? '')
    return withStage(base, data?.stats?.stage ?? null)
  }, [data])

  const mood = data === null ? BOOTING : data.paired && data.mood ? data.mood : NOTHING_YET
  const hex = EMOTION_META[mood.emotion].hex
  const reading = data?.paired ? data.latest : null
  const lifetimeMoisture = data?.stats?.windows.lifetime.moisture

  return (
    <Frame
      emotion={mood.emotion}
      title={`${slug} — a live plant, scored by its own soil`}
      sub={data ? `${profile.emoji} ${profile.label} // ${slug}` : slug}
      badge="LIVE FEED // READ-ONLY"
    >
      <Quote headline={mood.headline} reason={mood.reason} notes={mood.notes} hex={hex} />

      {/* Everything below only READS what the soil said. The simulator's HUD
          keeps a room full of levers under this line; here there is no line,
          because there is no room — the plant is real and somewhere else. */}
      <div className="flex items-end justify-between gap-8 px-5 pb-5 md:px-8">
        <div className="grid w-full max-w-sm grid-cols-1 gap-3">
          <div className="flex items-center gap-2 pb-0.5">
            <span className="text-[10px] tracking-widest text-muted-foreground/40">PROBE FEED</span>
            <span className="h-px flex-1 bg-border/60" />
          </div>
          {reading ? (
            profile.axes.map((a) => {
              const v = axisValue(reading, a.key)
              return v === undefined ? null : <Gauge key={a.key} axis={a} value={v} hex={hex} />
            })
          ) : (
            <p className="text-[10px] tracking-wider text-muted-foreground/40">NO READINGS YET</p>
          )}
        </div>

        <div className="flex w-full max-w-sm flex-col gap-2">
          <div className="flex items-center gap-2 pb-0.5">
            <span className="text-[10px] tracking-widest text-muted-foreground/40">CARE RECORD</span>
            <span className="h-px flex-1 bg-border/60" />
          </div>
          {data?.paired && (
            <p className="text-[10px] tracking-wider text-muted-foreground/50">
              {careLine(data.events, Date.now())}
            </p>
          )}
          {lifetimeMoisture && (
            <p className="text-[10px] tracking-wider text-muted-foreground/40">
              LIFETIME: MOISTURE IN BAND {lifetimeMoisture.pct_in_band.toFixed(1)}% (
              {lifetimeMoisture.ok_count} OK / {lifetimeMoisture.out_count} OUT)
            </p>
          )}
          {data?.paired && (
            <Wellbeing
              value={mood.wellbeing}
              hex={hex}
              note={
                <>
                  MOVES IN DAYS, NOT SECONDS &mdash; HARM LANDS 3&times; FASTER THAN CARE
                  <br />
                  <span className="text-muted-foreground/40">
                    THIS PAGE ONLY READS. NOTHING HERE CAN RAISE IT — ONLY THE SOIL CAN.
                  </span>
                </>
              }
            />
          )}
        </div>
      </div>
    </Frame>
  )
}

// ── public mode ─────────────────────────────────────────────────────────────

/** The seven whitelisted fields, said out loud in the page's own words. */
const LAST_SEEN: Record<LastSeenBucket, string> = {
  now: 'HEARD FROM JUST NOW',
  minutes: 'HEARD FROM WITHIN THE HOUR',
  hours: 'HEARD FROM TODAY',
  days: 'QUIET FOR DAYS',
}

/**
 * The shareable page: whatever /api/public/[slug] whitelists, and nothing
 * else. `initial` comes from the server render so the first paint of a public
 * plant is its real face, not a spinner; null means the store could not
 * answer at render time, and the poll keeps asking. A 404 mid-visit means the
 * keeper unpublished — the page honestly becomes the not-found state instead
 * of freezing the last portrait.
 */
export function PublicPlant({
  slug,
  initial,
}: {
  slug: string
  initial: PublicProjection | null
}) {
  const [proj, setProj] = useState<PublicProjection | null>(initial)
  const [gone, setGone] = useState(false)

  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const res = await fetch(`/api/public/${encodeURIComponent(slug)}`, { cache: 'no-store' })
        if (res.status === 404) {
          if (alive) {
            setGone(true)
            setProj(null)
          }
          return
        }
        if (!res.ok) return // 503 says "later", so we keep the last truth
        const body = (await res.json()) as PublicProjection
        if (alive) {
          setGone(false)
          setProj(body)
        }
      } catch {
        // Our network, our problem — not the plant's.
      }
    }
    if (initial === null) void poll() // the server could not ask; we do
    const id = setInterval(() => void poll(), POLL_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [slug, initial])

  if (gone) return <PlantNotFound slug={slug} />

  if (proj === null) {
    return (
      <Frame
        emotion={BOOTING.emotion}
        title={`${slug} — a live plant, scored by its own soil`}
        sub={slug}
        badge="PUBLIC PAGE // READ-ONLY"
      >
        <Quote headline={BOOTING.headline} reason={BOOTING.reason} hex={EMOTION_META[BOOTING.emotion].hex} />
        <div />
      </Frame>
    )
  }

  const sp = speciesById(proj.species)
  const hex = EMOTION_META[proj.emotion].hex

  return (
    <Frame
      emotion={proj.emotion}
      title={`${proj.label} — a live plant, scored by its own soil`}
      sub={`${sp.emoji} ${sp.label} // ${proj.label}`}
      badge="PUBLIC PAGE // READ-ONLY"
    >
      <Quote headline={proj.headline} hex={hex} />

      <div className="flex justify-end px-5 pb-5 md:px-8">
        <div className="flex w-full max-w-sm flex-col gap-2">
          <div className="flex items-center gap-2 pb-0.5">
            <span className="text-[10px] tracking-widest text-muted-foreground/40">
              WHAT THE SOIL WITNESSED
            </span>
            <span className="h-px flex-1 bg-border/60" />
          </div>
          <p className="text-[10px] tracking-wider text-muted-foreground/50">
            {LAST_SEEN[proj.lastSeen]} &mdash; WATERED ×{proj.careCounts.water} · FED ×
            {proj.careCounts.feed}
          </p>
          <Wellbeing
            value={proj.wellbeing}
            hex={hex}
            note={
              <span className="text-muted-foreground/40">
                SCORED BY THE SERVER FROM THE SOIL&apos;S OWN RECORD. THIS PAGE ONLY READS.
              </span>
            }
          />
        </div>
      </div>
    </Frame>
  )
}

// ── not found ───────────────────────────────────────────────────────────────

/**
 * The clean dead end. A misspelled URL, an unknown slug, a private plant and
 * a never-posted plant all land here off the same refusal (lib/derive.ts
 * PUBLIC_NOT_FOUND) — the page repeats the API's discipline and refuses to
 * say which, because distinguishability is the leak. Neutral face, no alarm:
 * an address with nobody home is an absence, not an emergency.
 */
export function PlantNotFound({ slug }: { slug?: string }) {
  const hex = EMOTION_META.neutral.hex
  return (
    <Frame
      emotion="neutral"
      title="Nothing answers at this address"
      sub={slug ?? 'NO ONE HERE'}
      badge="PUBLIC DOOR // READ-ONLY"
    >
      <Quote
        headline="Nobody by that name."
        reason="Nothing public answers at this address — a misspelled page, a private plant, or one that never existed, and this door does not say which. Unknown and unpublished look identical on purpose: a page that can be probed for names is a leak."
        hex={hex}
      />
      <div />
    </Frame>
  )
}
