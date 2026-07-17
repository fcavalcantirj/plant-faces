'use client'

// The care record: one wellbeing curve + the events the soil witnessed.
// It renders what the server derived. It computes nothing.

import type { CareEvent, SeriesPoint } from '@/lib/plant-mood'

const W = 560
const H = 64

export function Sparkline({
  series,
  events,
  hex,
}: {
  series: SeriesPoint[]
  events: CareEvent[]
  hex: string
}) {
  if (series.length < 2) {
    return (
      <div className="flex h-16 items-center justify-center rounded-sm border border-dashed border-border/60 text-[10px] tracking-widest text-muted-foreground/40">
        WAITING FOR HISTORY
      </div>
    )
  }

  const t0 = series[0].ts
  const t1 = series[series.length - 1].ts
  const span = Math.max(1, t1 - t0)
  const x = (ts: number) => ((ts - t0) / span) * W
  const y = (w: number) => H - (w / 100) * H

  const path = series.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.ts).toFixed(1)},${y(p.wellbeing).toFixed(1)}`).join(' ')
  const area = `${path} L${W},${H} L0,${H} Z`
  const days = span / 86_400_000

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] tracking-widest text-muted-foreground/40">
          CARE RECORD &mdash; {days < 1 ? `${(days * 24).toFixed(0)}H` : `${days.toFixed(1)} DAYS`}
        </span>
        <span className="flex items-center gap-3 text-[9px] tracking-wider text-muted-foreground/40">
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-sky-400" /> WATERED
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" /> FED
          </span>
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-16 w-full"
        role="img"
        aria-label={`Wellbeing over ${days.toFixed(1)} days, currently ${series[series.length - 1].wellbeing.toFixed(0)} of 100`}
      >
        {/* the happy line: 55/100, where the face turns happy */}
        <line x1="0" y1={y(55)} x2={W} y2={y(55)} stroke="currentColor" strokeWidth="0.5" strokeDasharray="3 4" className="text-muted-foreground/25" />
        <path d={area} fill={hex} opacity={0.1} />
        <path d={path} fill="none" stroke={hex} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        {events.map((e, i) => (
          <circle
            key={`${e.ts}-${e.kind}-${i}`}
            cx={x(e.ts)}
            cy={H - 3}
            r={2.5}
            fill={e.kind === 'water' ? '#38bdf8' : '#fbbf24'}
          />
        ))}
      </svg>
    </div>
  )
}
