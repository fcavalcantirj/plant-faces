"""Minimal Parquet build: readings fixture -> validated readings.parquet.

The build refuses rather than repairs. A fixture row that claims imputation,
carries an unregistered flag bit, sets the reserved leaf-offset bit, or fills
vpd_leaf_kpa is a schema violation — the build dies loudly and nothing is
written. VPD is derived HERE (etl/vpd.py, versioned), never accepted from the
fixture: a stored VPD with no derivation on record is unauditable.

After writing, the build reloads the file and proves the round trip is
identical — a Parquet that reads back different from what was built is a
corrupt artifact, not a warning.

    .venv/bin/python -m etl.build [fixture.json] [out.parquet]
"""

import json
import math
import sys
from pathlib import Path

import pandas as pd

from etl.vpd import DERIVATION_VERSION, vpd_air_kpa

DEFAULT_FIXTURE = Path(__file__).parent / "fixtures" / "readings.sample.json"
DEFAULT_OUT = Path(__file__).parent.parent / "build" / "readings.parquet"

# Fixture columns, in canonical order. Derived columns (vpd_air_kpa,
# vpd_air_sigma_kpa, derivation_version) are NOT here — they exist only as
# ETL output, and a fixture supplying them is refused as an extra column.
FIXTURE_DTYPES: dict[str, str] = {
    "plant_id": "object",
    "device_id": "object",
    "ts_utc_ms": "int64",
    "air_temp_c": "float64",
    "rh_pct": "float64",
    "soil_moisture_pct": "float64",
    "soil_temp_c": "float64",
    "soil_ec_ms_cm": "float64",
    "soil_ph": "float64",
    "vpd_leaf_kpa": "float64",
    "ingest_source": "object",
    "sensor_flags": "int64",
    "is_imputed": "bool",
    "calibration_status": "object",
    "qc_status": "object",
}

CALIBRATION_STATUSES = {"raw", "factory", "user"}
QC_STATUSES = {"unverified", "verified"}
INGEST_SOURCES = {"live", "backfill"}

# Registered sensor_flags bits (schema/flags.md). Bit 5 (ASSUMED_LEAF_OFFSET)
# is reserved and must never be set; bits above the registry don't exist.
KNOWN_FLAG_BITS = 0b011111
RESERVED_FLAG_BITS = 0b100000


def load_fixture(path: Path) -> pd.DataFrame:
    rows = json.loads(path.read_text())
    if not isinstance(rows, list) or not rows:
        raise ValueError(f"{path}: fixture must be a non-empty JSON list of rows")
    df = pd.DataFrame(rows)

    expected = set(FIXTURE_DTYPES)
    got = set(df.columns)
    if got != expected:
        missing, extra = sorted(expected - got), sorted(got - expected)
        raise ValueError(f"{path}: fixture columns wrong — missing={missing} extra={extra}")

    # Explicit dtypes, canonical order. JSON null becomes NaN in float columns
    # — absence, which is honest; imputation, which is not, is refused below.
    return df[list(FIXTURE_DTYPES)].astype(FIXTURE_DTYPES)


def validate(df: pd.DataFrame) -> pd.DataFrame:
    if df["is_imputed"].any():
        raise ValueError("is_imputed=true found — we refuse imputation; gaps stay gaps")

    bad_cal = set(df["calibration_status"]) - CALIBRATION_STATUSES
    if bad_cal:
        raise ValueError(f"unknown calibration_status {sorted(bad_cal)} — allowed: {sorted(CALIBRATION_STATUSES)}")
    bad_qc = set(df["qc_status"]) - QC_STATUSES
    if bad_qc:
        raise ValueError(f"unknown qc_status {sorted(bad_qc)} — allowed: {sorted(QC_STATUSES)}")
    bad_src = set(df["ingest_source"]) - INGEST_SOURCES
    if bad_src:
        raise ValueError(f"unknown ingest_source {sorted(bad_src)} — allowed: {sorted(INGEST_SOURCES)}")

    flags = df["sensor_flags"]
    if (flags < 0).any():
        raise ValueError("sensor_flags must be non-negative")
    if (flags & RESERVED_FLAG_BITS).any():
        raise ValueError("ASSUMED_LEAF_OFFSET (bit 5) is reserved and must never be set")
    if (flags & ~KNOWN_FLAG_BITS).any():
        raise ValueError("sensor_flags carries bits not registered in schema/flags.md")

    if df["vpd_leaf_kpa"].notna().any():
        raise ValueError("vpd_leaf_kpa must be NULL until a leaf IR sensor exists")

    return df


def derive(df: pd.DataFrame) -> pd.DataFrame:
    """Add the derived columns. Rows missing an input keep NaN — absence
    propagates as absence. Sigma stays NaN until device sigmas exist
    (SHT4x co-location, Wave 4): an error bar we can't compute is one we
    don't publish."""
    vpd = [
        math.nan if pd.isna(t) or pd.isna(rh) else vpd_air_kpa(float(t), float(rh))
        for t, rh in zip(df["air_temp_c"], df["rh_pct"])
    ]
    df = df.copy()
    df["vpd_air_kpa"] = pd.Series(vpd, dtype="float64", index=df.index)
    df["vpd_air_sigma_kpa"] = pd.Series(math.nan, dtype="float64", index=df.index)
    df["derivation_version"] = DERIVATION_VERSION
    return df


def build(fixture_path: Path = DEFAULT_FIXTURE, out_path: Path = DEFAULT_OUT) -> pd.DataFrame:
    df = derive(validate(load_fixture(fixture_path)))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out_path, index=False)

    reloaded = pd.read_parquet(out_path)
    pd.testing.assert_frame_equal(df.reset_index(drop=True), reloaded)
    return reloaded


if __name__ == "__main__":
    fixture = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_FIXTURE
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_OUT
    result = build(fixture, out)
    print(f"{out}: {len(result)} rows, round-trip verified, derivation={DERIVATION_VERSION}")
