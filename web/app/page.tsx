'use client'

// The demo's wiring:
//
//   the pot (simulated)  ->  readings held here  ->  POST /api/derive  ->  render
//
// The browser holds the readings because IT IS THE DEVICE — the sim stands in
// for an ESP32 that does not exist yet. But it never SCORES them: every digit on
// screen is computed by the server from the raw readings, so nothing in this
// page can talk the plant into being happy.
//
// The real probe uses a different door on purpose: POST /api/ingest, into
// durable storage. It posts once every 15 min and its history matters. The sim
// compresses a fortnight into a minute — ~2,700x the event rate — so putting it
// behind per-event storage costs money to persist data nobody wants.
// See app/api/derive/route.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AgentFace } from '@/components/agent-face'
import { PlantHud } from '@/components/plant-hud'
import { toWire } from '@/lib/ingest'
import {
  detectEvents,
  type CareEvent,
  type MoodResult,
  type SensorReading,
  type SeriesPoint,
} from '@/lib/plant-mood'
import {
  feed,
  flood,
  fortnight,
  newPot,
  probeReading,
  stepPot,
  water,
  type Climate,
  type Pot,
} from '@/lib/plant-sim'
import { DEFAULT_SPECIES, speciesById } from '@/lib/species'

/** Simulated hours per real second. */
const HOURS_PER_SECOND = 1.5
const TICK_MS = 100
/** The node's planned cadence: one reading every 15 min of plant time. */
const POST_EVERY_SIM_HOURS = 0.5

/**
 * The simulator's device id.
 *
 * A single constant is safe here ONLY because nothing is stored: each visitor's
 * readings live in their own browser, so two people cannot collide. The moment
 * anything persists server-side this must go back to being per-device — a token
 * identifies a device, and a shared one is exactly the unverifiable data the
 * product refuses.
 */
const DEMO_DEVICE = 'dev_plantfaces_simulator'

/**
 * The boot state, before the first reading has been scored.
 *
 * ⚠ This used to be `glitch` — and `glitch` is an ALARM ("SIGNAL LOST", X'd-out
 * eyes, "Am I still here?"). It means the probe went silent. Using it as a
 * loading state fired that alarm on every single page load, so the first thing
 * anyone saw was a plant reporting a fault that was not happening. An alarm that
 * cries wolf on boot is an alarm people learn to ignore. "I have not computed
 * yet" is not "the probe is dead" — say the true thing.
 */
const BOOTING: MoodResult = {
  emotion: 'neutral',
  wellbeing: 0,
  comfort: 0,
  headline: 'Waking up…',
  reason: 'Reading the soil.',
  notes: [],
}

export default function Page() {
  const [speciesId, setSpeciesId] = useState(DEFAULT_SPECIES.id)
  const [climate, setClimate] = useState<Climate>('mild')
  const [paused, setPaused] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  // The pot's clock starts at Date.now(), so anything showing it differs between
  // the prerendered HTML and the browser — a hydration mismatch (React #418).
  // The HUD is the only time-dependent surface, so it waits for the client.
  const [mounted, setMounted] = useState(false)

  const profile = useMemo(() => speciesById(speciesId), [speciesId])
  // Which fortnight we are replaying, if any. This is STATE, not a ref: the ref
  // below is rebuilt on every render, so a token parked there gets clobbered.
  const [scenario, setScenario] = useState<'care' | 'neglect' | null>(null)
  /** The probe's own record. In the product this lives on a server; here the
      browser is the device, so it lives with the device. */
  const readingsRef = useRef<SensorReading[]>([])

  const [pot, setPot] = useState<Pot>(() => newPot(DEFAULT_SPECIES))
  const [startTime, setStartTime] = useState(() => pot.ts)
  const [mood, setMood] = useState<MoodResult>(BOOTING)
  const [series, setSeries] = useState<SeriesPoint[]>([])
  const [events, setEvents] = useState<CareEvent[]>([])
  const [latest, setLatest] = useState<SensorReading | null>(null)

  const live = useRef({ profile, climate, paused, lastPostTs: -Infinity })
  live.current = { ...live.current, profile, climate, paused }

  /** The probe emits a reading. Same shape, same validation, no storage. */
  const emit = useCallback((reading: SensorReading) => {
    const rows = readingsRef.current
    const at = rows.findIndex((r) => r.ts === reading.ts)
    if (at >= 0) rows[at] = reading
    else rows.push(reading)
    if (rows.length > 2000) rows.splice(0, rows.length - 2000)
  }, [])

  /** Ask the server to score what the probe said. It does every calculation. */
  const derive = useCallback(async (rows: SensorReading[], sp: string) => {
    if (rows.length === 0) {
      setMood(BOOTING)
      setSeries([])
      setEvents([])
      setLatest(null)
      return
    }
    const res = await fetch('/api/derive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        species: sp,
        readings: rows.map((r) => toWire(r, DEMO_DEVICE)),
      }),
    })
    if (!res.ok) return
    const data = await res.json()
    if (!data.paired) return
    setMood(data.mood)
    setSeries(data.series)
    setLatest(data.latest)
    setEvents(detectEvents(data.series))
  }, [])

  // The pot ticks; the probe reports on its own cadence.
  //
  // Never step past the present: the pot starts two weeks back and fast-forwards
  // to now, at which point it simply runs in real time. You cannot skip ahead of
  // the wall clock — which is honest, and is also what /api/ingest enforces.
  const advance = useCallback(
    (hours: number) => {
      setPot((p) => {
        const { profile: pr, climate: cl } = live.current
        const ts = Math.min(p.ts + hours * 3_600_000, Date.now())
        const dtHours = (ts - p.ts) / 3_600_000
        if (dtHours <= 0) return p

        const next = stepPot(p, pr, cl, dtHours)
        if (next.ts - live.current.lastPostTs >= POST_EVERY_SIM_HOURS * 3_600_000) {
          live.current.lastPostTs = next.ts
          emit(probeReading(next, cl))
        }
        return next
      })
    },
    [emit],
  )

  useEffect(() => {
    const id = setInterval(() => {
      if (live.current.paused || busy) return
      advance((TICK_MS / 1000) * HOURS_PER_SECOND)
    }, TICK_MS)
    return () => clearInterval(id)
  }, [advance, busy])

  // Ask the server to score the record. One request, not one per reading.
  useEffect(() => {
    const id = setInterval(() => {
      void derive(readingsRef.current, live.current.profile.id)
    }, 600)
    return () => clearInterval(id)
  }, [derive])

  // First paint: emit one reading and score it immediately. Waiting for the
  // 600ms tick left a window with no data, which is what got rendered as a
  // fault. The probe has something to say the moment the page exists.
  useEffect(() => {
    let alive = true
    const boot = async () => {
      const { profile: pr, climate: cl } = live.current
      const first = probeReading(pot, cl)
      live.current.lastPostTs = first.ts
      emit(first)
      await derive(readingsRef.current, pr.id)
      if (alive) setMounted(true)
    }
    void boot()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A fresh pot — and a fresh record — when the plant changes.
  useEffect(() => {
    live.current.lastPostTs = -Infinity
    readingsRef.current = []
    setScenario(null)
    const fresh = newPot(profile)
    setPot(fresh)
    setStartTime(fresh.ts)
  }, [profile])

  const act = (fn: (p: Pot) => Pot) => {
    backToLive()
    setPot((p) => {
      const next = fn(p)
      live.current.lastPostTs = next.ts
      emit(probeReading(next, live.current.climate))
      return next
    })
  }

  /** The time-lapse: fourteen days of readings, through the same one door. */
  const runScenario = async (kind: 'care' | 'neglect') => {
    setBusy(kind === 'care' ? 'REPLAYING 14 DAYS OF GOOD CARE…' : 'REPLAYING 14 DAYS OF NEGLECT…')
    const rows = fortnight(profile, climate, kind, Date.now())
    readingsRef.current = rows
    setPaused(true)
    setScenario(kind)
    setPot({ ts: rows[rows.length - 1].ts, moisture: rows[rows.length - 1].moisture, ec: rows[rows.length - 1].ec, ph: rows[rows.length - 1].ph })
    await derive(rows, profile.id)
    setBusy(null)
  }

  /** Touching the pot leaves the replay and starts a fresh live record. */
  const backToLive = () => {
    if (scenario) {
      setScenario(null)
      setPaused(false)
      readingsRef.current = []
      live.current.lastPostTs = -Infinity
      const fresh = newPot(live.current.profile)
      setPot(fresh)
      setStartTime(fresh.ts)
    }
  }

  return (
    <main className="relative h-screen w-full overflow-hidden bg-background">
      <h1 className="sr-only">
        Plant Faces — a plant that gets happier or angrier at how you treat it
      </h1>
      <AgentFace emotion={mood.emotion} />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'repeating-linear-gradient(0deg, rgba(0,0,0,0.12) 0px, rgba(0,0,0,0.12) 1px, transparent 1px, transparent 3px), radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)',
        }}
      />
      {/* simTime/startTime describe what is ON SCREEN, not the live pot: while a
          fortnight was replaying, the header read "DAY 5" over a 14-day record. */}
      {mounted && (
      <div className="animate-in fade-in duration-700">
      <PlantHud
        mood={mood}
        reading={latest}
        series={series}
        events={events}
        profile={profile}
        climate={climate}
        simTime={latest?.ts ?? pot.ts}
        startTime={series[0]?.ts ?? startTime}
        paused={paused}
        busy={busy}
        onSpecies={setSpeciesId}
        onClimate={setClimate}
        onWater={() => act((p) => water(p, live.current.profile))}
        onFeed={() => act((p) => feed(p, live.current.profile))}
        onFlood={() => act((p) => flood(p, live.current.profile))}
        onSkip={() => advance(12)}
        onPause={() => setPaused((p) => !p)}
        onScenario={runScenario}
      />
      </div>
      )}
    </main>
  )
}
