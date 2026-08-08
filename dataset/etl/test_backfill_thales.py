# Pins the Thales.xlsx importer's pure parsing rules — the Sao Paulo
# wall-clock -> UTC epoch encoding, the date-mangled VPD decode, and the
# refuse-don't-guess row classifier. The xlsx itself is not a fixture here;
# these are the rules any re-export of the sheet must still satisfy.

import datetime

import pytest

from etl.backfill_thales import (
    SP_UTC_OFFSET_MS,
    classify_row,
    decode_sheet_vpd,
    envelope,
    to_epoch_ms_utc,
)


def test_epoch_ms_converts_sp_wall_clock_to_utc():
    # 2026-07-01 00:33:00.703 Sao Paulo wall clock (UTC-3, no DST) is
    # 03:33:00.703Z — no host-local offset may leak in (timegm + fixed +3h).
    dt = datetime.datetime(2026, 7, 1, 0, 33, 0, 703000)
    # 1782876780703 == 2026-07-01T03:33:00.703Z, checked independently via
    # datetime(..., tzinfo=timezone.utc).timestamp().
    assert to_epoch_ms_utc(dt) == 1782876780703


def test_epoch_ms_noon_wall_clock_is_1500z():
    # The canonical spot check: Sao Paulo noon is 15:00Z.
    noon = datetime.datetime(2026, 7, 1, 12, 0, 0)
    # 1782918000000 == 2026-07-01T15:00:00Z.
    assert to_epoch_ms_utc(noon) == 1782918000000


def test_epoch_ms_offset_is_exactly_3h():
    assert SP_UTC_OFFSET_MS == 10_800_000


def test_epoch_ms_refuses_tz_aware():
    aware = datetime.datetime(2026, 7, 1, tzinfo=datetime.timezone.utc)
    with pytest.raises(ValueError):
        to_epoch_ms_utc(aware)


def test_sheet_vpd_plain_text_parses():
    assert decode_sheet_vpd("0.75") == 0.75
    assert decode_sheet_vpd(None) is None


def test_sheet_vpd_date_mangle_decodes_day_dot_month():
    # The Sheets->xlsx export read "1.06" as day-1 month-06 of the current
    # year; the decode inverts exactly that.
    assert decode_sheet_vpd(datetime.datetime(2026, 6, 1)) == pytest.approx(1.06)
    assert decode_sheet_vpd(datetime.datetime(2026, 3, 2)) == pytest.approx(2.03)
    assert decode_sheet_vpd(datetime.datetime(2026, 10, 1)) == pytest.approx(1.10)


def test_sheet_vpd_unknown_shapes_are_refused_not_guessed():
    with pytest.raises(ValueError):
        decode_sheet_vpd(datetime.datetime(2025, 6, 1))  # wrong mangle year
    with pytest.raises(ValueError):
        decode_sheet_vpd(datetime.datetime(2026, 6, 1, 12, 30))  # not midnight
    with pytest.raises(ValueError):
        decode_sheet_vpd("not a number")


def test_classify_row_three_known_shapes():
    ts = datetime.datetime(2026, 7, 1)
    assert classify_row(ts, 25.5, 77.0) == "valid"
    assert classify_row(ts, "Erro na API", "expired") == "error"
    assert classify_row(None, None, None) == "blank"


def test_classify_row_refuses_partial_rows():
    ts = datetime.datetime(2026, 7, 1)
    with pytest.raises(ValueError):
        classify_row(ts, 25.5, None)  # temp without humidity
    with pytest.raises(ValueError):
        classify_row("2026-07-01", 25.5, 77.0)  # Data not a datetime


def test_envelope_shape_and_flags():
    row = envelope(1782693180703, 25.5, 77.0, "072026", "(OK) Vega")
    assert row["source_token"] == "tuya-sheets-backfill"
    assert row["channels"] == {"air_temp_c": 25.5, "rh_pct": 77.0}
    meta = row["meta"]
    assert meta["adapter"] == "sheets-backfill"
    assert meta["calibration"] == "uncalibrated"
    assert meta["ingest_source"] == "backfill"
    assert meta["sheet"] == "072026"
    assert meta["alarm_raw"] == "(OK) Vega"
    # The applied conversion travels with every row.
    assert meta["tz_note"] == "wall clock America/Sao_Paulo (UTC-3, no DST) converted to UTC epoch ms"
