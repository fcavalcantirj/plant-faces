# Pins the stats report's pure judges — the sheet->stage map, the inclusive
# band verdict, the label decode (verdict vs stage-note vs absent), the
# gap-aware streak, and the Sao Paulo month bucketing. The archive itself is
# not a fixture here; these are the rules any pull of it must satisfy.

import pytest

from etl.stats_report import (
    STAGE_BY_SHEET,
    band_verdict,
    label_verdict,
    longest_in_band_streak_hours,
    sp_month,
    stage_for_sheet,
)


def test_stage_map_pins_all_four_sheets():
    assert stage_for_sheet("072026") == "vega"
    assert stage_for_sheet("082026") == "vega"
    assert stage_for_sheet("062026") == "flora"
    assert stage_for_sheet("Tempo Real") == "flora"
    assert set(STAGE_BY_SHEET) == {"072026", "082026", "062026", "Tempo Real"}


def test_stage_map_refuses_unknown_sheet():
    with pytest.raises(ValueError):
        stage_for_sheet("092026")
    with pytest.raises(ValueError):
        stage_for_sheet(None)  # a row without meta.sheet judges nothing


def test_band_verdict_vega_bounds_inclusive():
    assert band_verdict(0.40, "vega")
    assert band_verdict(0.60, "vega")
    assert band_verdict(0.80, "vega")
    assert not band_verdict(0.399, "vega")
    assert not band_verdict(0.801, "vega")


def test_band_verdict_flora_bounds_inclusive():
    assert band_verdict(0.80, "flora")
    assert band_verdict(1.20, "flora")
    assert not band_verdict(0.799, "flora")
    assert not band_verdict(1.201, "flora")


def test_band_verdict_refuses_unknown_stage():
    with pytest.raises(ValueError):
        band_verdict(0.6, "seedling")


def test_label_verdict_ok_and_alerta():
    assert label_verdict("(OK) Vega") is True
    assert label_verdict("(OK) Flora") is True
    assert label_verdict("(OK) Final Vega / Inicio Flora") is True
    assert label_verdict("ALERTA: VPD ALTO") is False
    assert label_verdict("ALERTA: VPD BAIXO") is False


def test_label_verdict_notes_and_absence_are_no_testimony():
    assert label_verdict(None) is None
    # The sheet used the Alarme column for stage NOTES too — not verdicts.
    assert label_verdict("Final Vegetativo / Começo Flora") is None
    assert label_verdict("Meio / Final Flora") is None


HOUR = 3_600_000


def test_streak_simple_run_is_last_minus_first():
    samples = [(0, True), (HOUR, True), (2 * HOUR, True)]
    assert longest_in_band_streak_hours(samples, max_gap_ms=2 * HOUR) == 2.0


def test_streak_broken_by_out_of_band():
    samples = [(0, True), (HOUR, True), (2 * HOUR, False), (3 * HOUR, True), (4 * HOUR, True)]
    assert longest_in_band_streak_hours(samples, max_gap_ms=2 * HOUR) == 1.0


def test_streak_broken_by_gap():
    # 5h hole between in-band samples: the dark stretch cannot testify.
    samples = [(0, True), (HOUR, True), (6 * HOUR, True), (7 * HOUR, True)]
    assert longest_in_band_streak_hours(samples, max_gap_ms=2 * HOUR) == 1.0


def test_streak_gap_exactly_at_threshold_holds():
    samples = [(0, True), (2 * HOUR, True)]
    assert longest_in_band_streak_hours(samples, max_gap_ms=2 * HOUR) == 2.0


def test_streak_single_sample_proves_a_moment_not_an_hour():
    assert longest_in_band_streak_hours([(0, True)], max_gap_ms=HOUR) == 0.0
    assert longest_in_band_streak_hours([], max_gap_ms=HOUR) == 0.0
    assert longest_in_band_streak_hours([(0, False)], max_gap_ms=HOUR) == 0.0


def test_streak_refuses_non_ascending_ts():
    with pytest.raises(ValueError):
        longest_in_band_streak_hours([(HOUR, True), (0, True)], max_gap_ms=HOUR)
    with pytest.raises(ValueError):
        longest_in_band_streak_hours([(HOUR, True), (HOUR, True)], max_gap_ms=HOUR)


def test_sp_month_buckets_on_the_wall_clock():
    # 2026-07-01T01:00Z is 2026-06-30 22:00 in Sao Paulo — June, not July.
    assert sp_month(1782867600000) == "2026-06"
    # Sao Paulo midnight 2026-07-01 == 03:00Z — July begins.
    assert sp_month(1782874800000) == "2026-07"
