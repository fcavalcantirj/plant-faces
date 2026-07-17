'use client'

import { EMOTION_META } from '@/lib/face-points'
import { Sparkline } from '@/components/sparkline'
import { axisValue, type CareEvent, type MoodResult, type SensorReading, type SeriesPoint } from '@/lib/plant-mood'
import { PLANT_CLIMATES, type Climate } from '@/lib/plant-sim'
import { SPECIES, type AxisSpec, type SpeciesProfile } from '@/lib/species'

interface PlantHudProps {
  mood: MoodResult
  reading: SensorReading | null
  series: SeriesPoint[]
  events: CareEvent[]
  profile: SpeciesProfile
  climate: Climate
  simTime: number
  startTime: number
  paused: boolean
  busy: string | null
  onSpecies: (id: string) => void
  onClimate: (c: Climate) => void
  onWater: () => void
  onFeed: () => void
  onFlood: () => void
  onSkip: () => void
  onPause: () => void
  onScenario: (kind: 'care' | 'neglect') => void
}

function clockOf(ts: number) {
  const h = Math.floor((ts % 86_400_000) / 3_600_000)
  const m = Math.floor((ts % 3_600_000) / 60_000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
/** Day of the run, not day of the epoch: timestamps are real ms now. */
const dayOf = (ts: number, start: number) => Math.floor((ts - start) / 86_400_000) + 1

/** A reading bar showing the species' comfortable band behind the needle. */
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

function Chip({
  active,
  onClick,
  children,
  hex,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  hex: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-sm border px-2 py-1 text-[10px] tracking-widest transition-colors ${
        active
          ? 'border-current bg-card'
          : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
      }`}
      style={active ? { color: hex } : undefined}
    >
      {children}
    </button>
  )
}

const Btn = ({
  onClick,
  children,
  tone = 'plain',
  disabled,
}: {
  onClick: () => void
  children: React.ReactNode
  tone?: 'plain' | 'water' | 'feed'
  disabled?: boolean
}) => {
  const tones = {
    plain: 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground',
    water: 'border-sky-400/60 bg-sky-400/10 text-sky-300 hover:bg-sky-400/20',
    feed: 'border-amber-400/60 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-sm border px-2.5 py-2 text-[10px] tracking-widest transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]}`}
    >
      {children}
    </button>
  )
}

export function PlantHud({
  mood,
  reading,
  series,
  events,
  profile,
  climate,
  simTime,
  startTime,
  paused,
  busy,
  onSpecies,
  onClimate,
  onWater,
  onFeed,
  onFlood,
  onSkip,
  onPause,
  onScenario,
}: PlantHudProps) {
  const hex = EMOTION_META[mood.emotion].hex

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between font-mono">
      {/* top bar */}
      <header className="flex items-start justify-between border-b border-border/60 px-4 py-3 md:px-6">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-bold tracking-widest text-foreground">
            PLANT<span style={{ color: hex }}>FACES</span>
          </span>
          <span className="text-[10px] tracking-wider text-muted-foreground">
            {profile.emoji} {profile.label} // DAY {dayOf(simTime, startTime)} · {clockOf(simTime)}
          </span>
        </div>
        <div className="flex flex-col items-end gap-1 pt-1">
          <div className="flex items-center gap-2">
            <span
              className="h-1.5 w-1.5 animate-pulse rounded-full"
              style={{ backgroundColor: hex }}
              aria-hidden="true"
            />
            <span className="text-[10px] tracking-widest" style={{ color: hex }}>
              {EMOTION_META[mood.emotion].label}
            </span>
          </div>
          <span className="text-[10px] tracking-wider text-amber-300/60">
            NO PROBE PAIRED // SIMULATED SOIL
          </span>
        </div>
      </header>

      {/* What the plant is saying. Left gutter, vertically centred: the face owns
          the middle and its mouth is the whole point — never put text across it. */}
      <div className="pointer-events-none flex flex-1 items-center px-4 md:px-6">
        <div className="flex max-w-[15rem] flex-col gap-2 md:max-w-xs">
          <p
            className="text-xl leading-snug tracking-wide md:text-2xl"
            style={{ color: hex, textShadow: `0 0 18px ${hex}66` }}
          >
            &ldquo;{mood.headline}&rdquo;
          </p>
          <p className="text-[11px] leading-relaxed tracking-wider text-muted-foreground">
            {mood.reason}
          </p>
          {mood.notes.map((n) => (
            <p key={n} className="text-[10px] leading-relaxed tracking-wider text-muted-foreground/40">
              ⌇ {n}
            </p>
          ))}
        </div>
      </div>

      <div className="flex flex-col">
        {/* ── THE APP ─────────────────────────────────────────────────────
            Everything above the divider only READS what the soil said.
            There is deliberately no way to make the plant happy from here. */}
        <div className="flex items-end justify-between gap-8 px-5 pb-4 md:px-8">
          <div className="grid w-full max-w-sm grid-cols-1 gap-3">
            <div className="flex items-center gap-2 pb-0.5">
              <span className="text-[10px] tracking-widest text-muted-foreground/40">
                PROBE FEED
              </span>
              <span className="h-px flex-1 bg-border/60" />
            </div>
            {reading ? (
              profile.axes.map((a) => {
                const v = axisValue(reading, a.key)
                return v === undefined ? null : (
                  <Gauge key={a.key} axis={a} value={v} hex={hex} />
                )
              })
            ) : (
              <p className="text-[10px] tracking-wider text-muted-foreground/40">
                NO READINGS YET
              </p>
            )}
          </div>

          <div className="flex w-full max-w-lg flex-col gap-2">
            <Sparkline series={series} events={events} hex={hex} />
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] tracking-widest text-muted-foreground/60">
                WELLBEING
              </span>
              <span className="text-base tracking-widest" style={{ color: hex }}>
                {mood.wellbeing.toFixed(0)}
                <span className="text-[11px] text-muted-foreground/50">/100</span>
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-sm bg-white/8">
              <div
                className="h-full rounded-sm transition-[width] duration-700"
                style={{ width: `${mood.wellbeing}%`, backgroundColor: hex, boxShadow: `0 0 10px ${hex}` }}
              />
            </div>
            <p className="text-right text-[10px] leading-relaxed tracking-wider text-muted-foreground/50">
              MOVES IN DAYS, NOT SECONDS &mdash; HARM LANDS 3&times; FASTER THAN CARE
              <br />
              <span className="text-muted-foreground/40">
                NO BUTTON IN HERE CAN RAISE IT. ONLY THE SOIL CAN.
              </span>
            </p>
          </div>
        </div>

        {/* ── THE ROOM (scaffolding) ──────────────────────────────────────
            NOT the product. Stands in for physical reality until the ESP32 in
            builds/plant-node.md is flashed: these buttons do not water anything,
            they move the world the probe reads, and the probe POSTs it through
            the same /api/ingest the real node will use.
            DELETE THIS WHOLE BLOCK the day the node posts for real. */}
        <div className="pointer-events-auto border-t border-dashed border-border bg-white/[0.02] px-4 py-3.5">
          <div className="mb-2.5 flex items-center gap-2 px-1">
            <span className="text-[9px] tracking-widest text-amber-300/70">
              ⚙ THE ROOM &mdash; SIMULATED
            </span>
            <span className="h-px flex-1 bg-border/40" />
            <span className="hidden text-[9px] tracking-wider text-muted-foreground/40 md:block">
              A STAND-IN FOR THE PROBE &mdash; POSTS THE SAME /api/ingest THE ESP32 WILL
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2.5">
            <div className="flex items-center gap-1">
              <span className="mr-1 text-[9px] tracking-widest text-muted-foreground/40">POT</span>
              {SPECIES.map((s) => (
                <Chip key={s.id} active={s.id === profile.id} onClick={() => onSpecies(s.id)} hex={hex}>
                  {s.emoji} {s.label}
                </Chip>
              ))}
            </div>

            <div className="flex items-center gap-1">
              <span className="mr-1 text-[9px] tracking-widest text-muted-foreground/40">CLIMATE</span>
              {PLANT_CLIMATES.map((c) => (
                <Chip key={c} active={c === climate} onClick={() => onClimate(c)} hex={hex}>
                  {c.toUpperCase()}
                </Chip>
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              <Btn onClick={onWater} tone="water" disabled={!!busy}>💧 POUR WATER IN</Btn>
              <Btn onClick={onFeed} tone="feed" disabled={!!busy}>🧪 FEED IT</Btn>
              <Btn onClick={onFlood} disabled={!!busy}>🌊 FLOOD IT</Btn>
              <Btn onClick={onSkip} disabled={!!busy}>⏩ 12H PASS</Btn>
              <Btn onClick={onPause} disabled={!!busy}>{paused ? '▶ PLAY' : '⏸ PAUSE'}</Btn>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="mr-1 text-[9px] tracking-widest text-muted-foreground/40">
                2 WEEKS OF
              </span>
              <Btn onClick={() => onScenario('care')} disabled={!!busy}>🌞 GOOD CARE</Btn>
              <Btn onClick={() => onScenario('neglect')} disabled={!!busy}>💀 NEGLECT</Btn>
            </div>
          </div>

          {busy && (
            <p className="mt-2 text-center text-[9px] tracking-widest text-amber-300/70">
              {busy}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
