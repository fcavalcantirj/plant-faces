"""Time-in-band stats over the archived Thales backfill.

The plant's self-knowledge numbers — "90% of the time my VPD was perfect" —
computed the way the spreadsheet computed its own running tallies: count-based
OK vs Fora, stage-aware, no time-weighting. Reads the live archive (the same
rows etl/pull_archive.py builds the Parquet from), recomputes VPD in versioned
ETL (etl/vpd.py), and judges each reading against its stage's band.

Stage per sheet: each tab's Alarme header names the stage band it was
operating under ("Alarme Vega" / "Alarme Flora"); STAGE_BY_SHEET pins that
per tab. Bands are EMPIRICALLY DERIVED from the Thales.xlsx label boundaries
— PENDING Felipe's confirmation (T0.7b). They are extracted observations
about how the spreadsheet judged, not agronomy gospel.

Validation leg: rows whose meta.alarm_raw carries a verdict label
("(OK) ..." = in band, "ALERTA..." = out) are compared against OUR band
verdict and the agreement is reported. The sheet also used the Alarme column
for stage NOTES ("Final Vegetativo / Começo Flora", "Meio / Final Flora") —
those are not verdicts: they are counted and listed, never guessed into one.

Streaks: a streak is consecutive in-band readings with no gap wider than
GAP_FACTOR x the median cadence — a dark sensor cannot testify that the band
held while it was dark, so a gap breaks the streak (the same rule that sets
GAP_AFTER in the Parquet build).

    .venv/bin/python -m etl.stats_report
"""

import datetime

from etl.backfill_thales import SP_UTC_OFFSET_MS
from etl.pull_archive import (
    GAP_FACTOR,
    SOURCE_TOKEN,
    fetch_archive_rows,
    median_cadence_ms,
    resolve_dsn,
)
from etl.vpd import vpd_air_kpa

STAGE_BY_SHEET = {
    "072026": "vega",
    "082026": "vega",
    "062026": "flora",
    "Tempo Real": "flora",
}

# kPa bounds, inclusive. EMPIRICALLY DERIVED from the Thales.xlsx label
# boundaries — PENDING Felipe confirmation (T0.7b); see module docstring.
VPD_BANDS_KPA = {
    "vega": (0.40, 0.80),
    "flora": (0.80, 1.20),
}

LABEL_OK_PREFIX = "(OK)"
LABEL_ALERT_PREFIX = "ALERTA"

MS_PER_HOUR = 3_600_000


def stage_for_sheet(sheet) -> str:
    """Sheet tab -> growth stage. An unmapped tab is refused: judging a
    reading against a guessed stage band would be a fabricated verdict."""
    if sheet not in STAGE_BY_SHEET:
        raise ValueError(f"no stage mapping for sheet {sheet!r}")
    return STAGE_BY_SHEET[sheet]


def band_verdict(vpd_kpa: float, stage: str) -> bool:
    """True when the VPD sits inside the stage's band, bounds inclusive."""
    if stage not in VPD_BANDS_KPA:
        raise ValueError(f"no VPD band for stage {stage!r}")
    lo, hi = VPD_BANDS_KPA[stage]
    return lo <= vpd_kpa <= hi


def label_verdict(alarm_raw) -> bool | None:
    """Sheet label -> in-band verdict, or None where the cell carries no
    verdict (absent, or a stage note like 'Final Vegetativo / Começo Flora').
    None is 'no testimony', never a guessed verdict."""
    if not isinstance(alarm_raw, str):
        return None
    text = alarm_raw.strip()
    if text.startswith(LABEL_OK_PREFIX):
        return True
    if text.startswith(LABEL_ALERT_PREFIX):
        return False
    return None


def longest_in_band_streak_hours(samples, max_gap_ms: float) -> float:
    """Longest run of consecutive in-band samples, in hours.

    samples: (ts_ms, in_band) pairs, strictly ascending ts. An out-of-band
    sample or a gap wider than max_gap_ms breaks the run. Duration is
    last-minus-first of the run — a single sample proves a moment, not an
    hour, so it contributes 0.
    """
    best_ms = 0
    run_start = None
    prev_ts = None
    for ts, in_band in samples:
        if prev_ts is not None and ts <= prev_ts:
            raise ValueError("samples must be strictly ascending in ts")
        if in_band:
            if run_start is None or ts - prev_ts > max_gap_ms:
                run_start = ts
            best_ms = max(best_ms, ts - run_start)
        else:
            run_start = None
        prev_ts = ts
    return best_ms / MS_PER_HOUR


def sp_month(ts_ms: int) -> str:
    """UTC epoch ms -> 'YYYY-MM' on the America/Sao_Paulo wall clock (fixed
    UTC-3, no DST — the exact inverse of the backfill's +3h encoding)."""
    wall = _sp_wall(ts_ms)
    return f"{wall.year:04d}-{wall.month:02d}"


def _sp_wall(ts_ms: int) -> datetime.datetime:
    return datetime.datetime.fromtimestamp(
        (ts_ms - SP_UTC_OFFSET_MS) / 1000, tz=datetime.timezone.utc
    ).replace(tzinfo=None)


def _judge(rows: list[dict]) -> list[dict]:
    """Archive envelopes -> judged records (VPD recomputed, band verdict,
    label verdict, Sao Paulo month). Refuses rather than skips: an
    unclassifiable row here is a bug upstream, not a row to drop."""
    recs = []
    for r in rows:
        meta = r["meta"] or {}
        stage = stage_for_sheet(meta.get("sheet"))
        temp = float(r["channels"]["air_temp_c"])
        rh = float(r["channels"]["rh_pct"])
        vpd = vpd_air_kpa(temp, rh)  # refuses implausible temp/RH
        recs.append(
            {
                "ts": r["ts"],
                "sheet": meta.get("sheet"),
                "stage": stage,
                "month": sp_month(r["ts"]),
                "temp": temp,
                "rh": rh,
                "vpd": vpd,
                "in_band": band_verdict(vpd, stage),
                "alarm_raw": meta.get("alarm_raw"),
            }
        )
    return recs


def _stat_line(name: str, stage: str, sub: list[dict], max_gap_ms: float) -> str:
    n = len(sub)
    ok = sum(1 for x in sub if x["in_band"])
    pct = 100.0 * ok / n
    streak = longest_in_band_streak_hours([(x["ts"], x["in_band"]) for x in sub], max_gap_ms)
    return f"{name:<12} {stage:<10} {n:>5} {ok:>5} {n - ok:>5} {pct:>10.1f}% {streak:>16.1f}"


def print_report(recs: list[dict], cadence_ms: float) -> None:
    max_gap_ms = GAP_FACTOR * cadence_ms
    lo_v, hi_v = VPD_BANDS_KPA["vega"]
    lo_f, hi_f = VPD_BANDS_KPA["flora"]

    print(f"== ARCHIVE STATS — source {SOURCE_TOKEN!r} ==")
    print(
        f"rows: {len(recs)}   span: {_sp_wall(recs[0]['ts']).isoformat(sep=' ', timespec='minutes')}"
        f" -> {_sp_wall(recs[-1]['ts']).isoformat(sep=' ', timespec='minutes')} (America/Sao_Paulo wall clock)"
    )
    print(
        f"median cadence: {cadence_ms / 60000:.1f} min   streak/gap rule:"
        f" gap > {max_gap_ms / 60000:.1f} min breaks a streak"
    )
    print(
        "bands (EMPIRICALLY DERIVED from Thales.xlsx label boundaries — PENDING Felipe confirmation):"
        f" vega OK {lo_v:.2f}..{hi_v:.2f} kPa; flora OK {lo_f:.2f}..{hi_f:.2f} kPa"
    )
    print("pct is count-based (in-band readings / readings), matching the sheet's own OK/Fora tallies.")

    header = f"{'':<12} {'stage':<10} {'n':>5} {'ok':>5} {'out':>5} {'pct_in_band':>11} {'longest_streak_h':>16}"
    print("\n-- per sheet --")
    print(header)
    sheets = list(dict.fromkeys(x["sheet"] for x in recs))  # first-appearance = chronological
    for sheet in sheets:
        sub = [x for x in recs if x["sheet"] == sheet]
        print(_stat_line(sheet, sub[0]["stage"], sub, max_gap_ms))

    print("\n-- per America/Sao_Paulo calendar month --")
    print(header)
    months = sorted(set(x["month"] for x in recs))
    for month in months:
        sub = [x for x in recs if x["month"] == month]
        stages = "+".join(sorted(set(x["stage"] for x in sub)))
        print(_stat_line(month, stages, sub, max_gap_ms))

    print("\n-- headline, per month --")
    for month in months:
        sub = [x for x in recs if x["month"] == month]
        ok = sum(1 for x in sub if x["in_band"])
        stages = "+".join(sorted(set(x["stage"] for x in sub)))
        print(f"{month}: VPD in band {100.0 * ok / len(sub):.1f}% of the time ({stages} band, n={len(sub)})")

    # Validation leg: our verdict vs the sheet's own label, where one exists.
    labeled = [x for x in recs if label_verdict(x["alarm_raw"]) is not None]
    notes: dict[str, int] = {}
    absent = 0
    for x in recs:
        if x["alarm_raw"] is None:
            absent += 1
        elif label_verdict(x["alarm_raw"]) is None:
            notes[x["alarm_raw"]] = notes.get(x["alarm_raw"], 0) + 1
    agree = [x for x in labeled if label_verdict(x["alarm_raw"]) == x["in_band"]]
    disagree = [x for x in labeled if label_verdict(x["alarm_raw"]) != x["in_band"]]

    print("\n-- validation vs sheet labels --")
    ok_n = sum(1 for x in labeled if label_verdict(x["alarm_raw"]))
    print(f"labeled rows: {len(labeled)} ((OK)*: {ok_n}, ALERTA*: {len(labeled) - ok_n})")
    print(f"no-verdict rows excluded: absent={absent}, stage notes={notes}")
    print(f"agreement: {len(agree)}/{len(labeled)} ({100.0 * len(agree) / len(labeled):.2f}%)")
    for sheet in sheets:
        sub = [x for x in labeled if x["sheet"] == sheet]
        if not sub:
            continue
        sub_agree = sum(1 for x in sub if label_verdict(x["alarm_raw"]) == x["in_band"])
        print(f"  {sheet:<12} {sub_agree}/{len(sub)} ({100.0 * sub_agree / len(sub):.2f}%)")
    print(f"disagreements: {len(disagree)} — first 3:")
    for x in disagree[:3]:
        ours = "in" if x["in_band"] else "out"
        theirs = "in" if label_verdict(x["alarm_raw"]) else "out"
        print(
            f"  {_sp_wall(x['ts']).isoformat(sep=' ', timespec='minutes')} [{x['sheet']}/{x['stage']}]"
            f" temp={x['temp']:.1f}C rh={x['rh']:.1f}% vpd={x['vpd']:.3f} kPa"
            f" ours={ours} sheet={theirs} (label={x['alarm_raw']!r})"
        )


def main() -> None:
    rows = fetch_archive_rows(resolve_dsn())
    if not rows:
        raise RuntimeError(f"archive returned no rows for {SOURCE_TOKEN!r}")
    cadence_ms = median_cadence_ms([r["ts"] for r in rows])
    print_report(_judge(rows), cadence_ms)


if __name__ == "__main__":
    main()
