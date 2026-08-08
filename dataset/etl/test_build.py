# Pins the build's two promises: the Parquet round trip is IDENTICAL (a file
# that reads back different is corrupt, not approximate), and the honesty
# gates refuse bad fixtures instead of cleaning them.

import json

import pandas as pd
import pytest

from etl.build import DEFAULT_FIXTURE, build, load_fixture, validate
from etl.vpd import DERIVATION_VERSION, vpd_air_kpa


def test_round_trip_is_identical(tmp_path):
    out = tmp_path / "readings.parquet"
    reloaded = build(DEFAULT_FIXTURE, out)
    # build() already asserts written == reloaded; re-prove it independently.
    pd.testing.assert_frame_equal(reloaded, pd.read_parquet(out))
    assert len(reloaded) == len(json.loads(DEFAULT_FIXTURE.read_text()))


def test_is_imputed_always_false(tmp_path):
    reloaded = build(DEFAULT_FIXTURE, tmp_path / "readings.parquet")
    assert not reloaded["is_imputed"].any()
    assert reloaded["is_imputed"].dtype == bool


def test_vpd_derived_not_copied(tmp_path):
    reloaded = build(DEFAULT_FIXTURE, tmp_path / "readings.parquet")
    air = reloaded[reloaded["air_temp_c"].notna()]
    soil = reloaded[reloaded["air_temp_c"].isna()]
    assert len(air) and len(soil)
    for _, row in air.iterrows():
        assert row["vpd_air_kpa"] == pytest.approx(vpd_air_kpa(row["air_temp_c"], row["rh_pct"]))
    # Soil-only rows have no air inputs: absence propagates as absence.
    assert soil["vpd_air_kpa"].isna().all()
    assert (reloaded["derivation_version"] == DERIVATION_VERSION).all()
    # Leaf VPD has no sensor yet; sigma has no device sigmas yet. Both NULL.
    assert reloaded["vpd_leaf_kpa"].isna().all()
    assert reloaded["vpd_air_sigma_kpa"].isna().all()


def _fixture_with(tmp_path, **overrides):
    rows = json.loads(DEFAULT_FIXTURE.read_text())
    rows[0].update(overrides)
    path = tmp_path / "mutated.json"
    path.write_text(json.dumps(rows))
    return path


def test_imputed_row_is_refused(tmp_path):
    path = _fixture_with(tmp_path, is_imputed=True)
    with pytest.raises(ValueError, match="refuse imputation"):
        validate(load_fixture(path))


def test_reserved_leaf_offset_bit_is_refused(tmp_path):
    path = _fixture_with(tmp_path, sensor_flags=32)
    with pytest.raises(ValueError, match="reserved"):
        validate(load_fixture(path))


def test_unregistered_flag_bit_is_refused(tmp_path):
    path = _fixture_with(tmp_path, sensor_flags=64)
    with pytest.raises(ValueError, match="not registered"):
        validate(load_fixture(path))


def test_unknown_calibration_status_is_refused(tmp_path):
    path = _fixture_with(tmp_path, calibration_status="vibes")
    with pytest.raises(ValueError, match="calibration_status"):
        validate(load_fixture(path))


def test_filled_leaf_vpd_is_refused(tmp_path):
    path = _fixture_with(tmp_path, vpd_leaf_kpa=1.1)
    with pytest.raises(ValueError, match="leaf IR"):
        validate(load_fixture(path))


def test_extra_column_is_refused(tmp_path):
    path = _fixture_with(tmp_path, vpd_air_kpa=1.27)
    with pytest.raises(ValueError, match="extra"):
        load_fixture(path)
