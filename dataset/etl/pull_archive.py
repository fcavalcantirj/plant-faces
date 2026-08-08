"""Live archive -> validated Parquet (build/archive_readings.parquet).

The Postgres archive (raw_readings on the Oracle box) is the authoritative
store. This pull reads the backfilled envelope rows — source_token
'tuya-sheets-backfill', the Thales.xlsx Tuya air temp/RH history — and turns
them into dataset rows through the SAME path as any fixture:
etl.build.load_fixture/validate/derive plus the Parquet round-trip proof.
The pull only MAPS envelopes to fixture-shaped rows; the build machinery does
all the judging (column gate, honesty gates, VPD derivation, round trip).

Mapping is refusal-shaped, never guess-shaped:
- meta.calibration 'uncalibrated' -> calibration_status 'raw' (uncharacterized
  Tuya sensor, per schema.md); 'factory' -> 'factory'; any other value refused.
- channel names map 1:1 to columns; an unknown channel is refused, not dropped
  (same doctrine as unknown channels at ingest).
- GAP_AFTER (flags.md bit 4) is set where the NEXT reading sits more than
  GAP_FACTOR x the median cadence away — the source went dark after this row.
  The last row has no next reading to measure against, so it stays unflagged:
  absence of evidence is not a flag.
- is_imputed is False on every row. Gaps stay gaps.

The connection string is a secret: resolved from the environment or the
gitignored .env.archive.local, used to connect, never printed.

    .venv/bin/python -m etl.pull_archive [out.parquet]
"""

import json
import os
import statistics
import sys
from pathlib import Path

import psycopg2

from etl.build import build

SOURCE_TOKEN = "tuya-sheets-backfill"

DSN_ENV_VAR = "ARCHIVE_DATABASE_URL"
ENV_FILE = Path(__file__).resolve().parents[2] / ".env.archive.local"

# Thalesadão's grow: plant-001 per the logs/plants.yaml template, sampled by
# the physical Tuya T/H sensor (schema.md devices example). ingest_source
# 'backfill' on every row records the ROUTE the data took; the device is
# still the sensor that measured it.
PLANT_ID = "plant-001"
DEVICE_ID = "tuya-th-01"

# The backfill source claims exactly these channels. Anything else appearing
# means the archive changed under us — refuse, don't drop.
CHANNEL_COLUMNS = ("air_temp_c", "rh_pct")

# meta.calibration -> schema calibration_status. 'uncalibrated' is the Tuya
# sensor's honest state: uncharacterized, i.e. schema 'raw'.
CALIBRATION_MAP = {"uncalibrated": "raw", "factory": "factory"}

GAP_AFTER_BIT = 16  # flags.md bit 4
GAP_FACTOR = 2.0  # a delta beyond 2x the median cadence is a gap, not jitter

DEFAULT_OUT = Path(__file__).parent.parent / "build" / "archive_readings.parquet"
# The fixture-shaped intermediate keeps the build path honest: the Parquet is
# produced by etl.build.build() from this file, not by a parallel code path.
INTERMEDIATE_JSON = Path(__file__).parent.parent / "build" / "archive_rows.fixture.json"


def resolve_dsn() -> str:
    """ARCHIVE_DATABASE_URL from the environment, else the gitignored env
    file at the repo root. The value is a secret — connect with it, never
    print it."""
    dsn = os.environ.get(DSN_ENV_VAR, "").strip()
    if dsn:
        return dsn
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            stripped = line.strip()
            if stripped.startswith(f"{DSN_ENV_VAR}="):
                value = stripped.split("=", 1)[1].strip().strip("'\"")
                if value:
                    return value
    raise RuntimeError(f"{DSN_ENV_VAR} not set and no usable line in {ENV_FILE}")


def fetch_archive_rows(dsn: str, source_token: str = SOURCE_TOKEN) -> list[dict]:
    """All archive rows for one source, ts-ascending. psycopg2 decodes the
    jsonb columns to dicts; ts is bigint UTC epoch ms (gated at ingest)."""
    conn = psycopg2.connect(dsn)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "select source_token, ts, channels, meta from raw_readings"
                " where source_token = %s order by ts",
                (source_token,),
            )
            return [
                {"source_token": tok, "ts": int(ts), "channels": ch, "meta": meta}
                for tok, ts, ch, meta in cur.fetchall()
            ]
    finally:
        conn.close()


def median_cadence_ms(ts_list: list[int]) -> float:
    """Median delta between consecutive timestamps. Needs >= 2 rows and a
    strictly increasing series — an equal or backwards timestamp means the
    UNIQUE(source_token, ts) + ORDER BY contract broke upstream."""
    if len(ts_list) < 2:
        raise ValueError("cadence needs at least 2 readings")
    deltas = [b - a for a, b in zip(ts_list, ts_list[1:])]
    if min(deltas) <= 0:
        raise ValueError("timestamps not strictly increasing")
    return float(statistics.median(deltas))


def gap_after_flags(ts_list: list[int], max_gap_ms: float) -> list[int]:
    """GAP_AFTER per row: set where the next reading is more than max_gap_ms
    away. The last row has no next reading to measure — it stays unflagged."""
    flags = [0] * len(ts_list)
    for i, (a, b) in enumerate(zip(ts_list, ts_list[1:])):
        if b - a > max_gap_ms:
            flags[i] = GAP_AFTER_BIT
    return flags


def fixture_row(row: dict, sensor_flags: int) -> dict:
    """One archive envelope -> one fixture-shaped row for etl.build."""
    channels = row["channels"]
    unknown = sorted(set(channels) - set(CHANNEL_COLUMNS))
    if unknown:
        raise ValueError(f"unknown channels {unknown} in archive row ts={row['ts']}")
    meta = row["meta"] or {}
    calibration = meta.get("calibration")
    if calibration not in CALIBRATION_MAP:
        raise ValueError(f"unmapped meta.calibration {calibration!r} at ts={row['ts']}")
    return {
        "plant_id": PLANT_ID,
        "device_id": DEVICE_ID,
        "ts_utc_ms": row["ts"],
        "air_temp_c": channels.get("air_temp_c"),
        "rh_pct": channels.get("rh_pct"),
        "soil_moisture_pct": None,
        "soil_temp_c": None,
        "soil_ec_ms_cm": None,
        "soil_ph": None,
        "vpd_leaf_kpa": None,  # no leaf IR sensor exists; stays NULL
        # Carried verbatim from meta; etl.build.validate gates the vocabulary.
        "ingest_source": meta.get("ingest_source"),
        "sensor_flags": sensor_flags,
        "is_imputed": False,  # always — gaps stay gaps
        "calibration_status": CALIBRATION_MAP[calibration],
        "qc_status": "unverified",  # everything lands wild; gold is hand-earned
    }


def main(out_path: Path = DEFAULT_OUT) -> None:
    rows = fetch_archive_rows(resolve_dsn())
    if not rows:
        raise RuntimeError(f"archive returned no rows for {SOURCE_TOKEN!r}")

    ts_list = [r["ts"] for r in rows]
    cadence = median_cadence_ms(ts_list)
    flags = gap_after_flags(ts_list, GAP_FACTOR * cadence)
    fixture = [fixture_row(r, f) for r, f in zip(rows, flags)]

    INTERMEDIATE_JSON.parent.mkdir(parents=True, exist_ok=True)
    INTERMEDIATE_JSON.write_text(json.dumps(fixture, ensure_ascii=False))

    built = build(INTERMEDIATE_JSON, out_path)

    gaps = sum(1 for f in flags if f)
    print(f"{out_path}: {len(built)} rows from archive source {SOURCE_TOKEN!r}")
    print(
        f"median cadence {cadence / 60000:.1f} min; GAP_AFTER on {gaps} rows"
        f" (next reading > {GAP_FACTOR:g}x median away); round-trip verified"
    )


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT)
