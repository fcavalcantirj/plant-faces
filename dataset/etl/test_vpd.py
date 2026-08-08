# Pins the VPD math to reference values. If these move, DERIVATION_VERSION
# must move with them — a changed formula under an unchanged version string is
# the one bug this file exists to make impossible.

import pytest

from etl.vpd import es_kpa, vpd_air_kpa, vpd_air_sigma_kpa

# The canonical worked example: 25 degC / 60 %RH with SHT41-class sensor
# sigmas (0.2 degC, 1.8 %RH), per the research doc and the master plan.
T, RH = 25.0, 60.0
SIGMA_T, SIGMA_RH = 0.2, 1.8


def test_es_reference_value():
    assert es_kpa(T) == pytest.approx(3.17, abs=0.01)


def test_vpd_reference_value():
    assert vpd_air_kpa(T, RH) == pytest.approx(1.27, abs=0.01)


def test_sigma_worked_example():
    assert vpd_air_sigma_kpa(T, RH, SIGMA_T, SIGMA_RH) == pytest.approx(0.06, abs=0.01)


def test_zero_sigmas_yield_exactly_zero():
    # Certainty in, certainty out — an invented error bar is still invention.
    assert vpd_air_sigma_kpa(T, RH, 0.0, 0.0) == 0.0


def test_es_monotone_in_temperature():
    assert es_kpa(T + 1) > es_kpa(T)


def test_vpd_monotone_in_inputs():
    # Warmer air pulls harder; wetter air pulls less.
    assert vpd_air_kpa(T + 1, RH) > vpd_air_kpa(T, RH)
    assert vpd_air_kpa(T, RH + 5) < vpd_air_kpa(T, RH)


def test_sigma_monotone_in_each_sigma():
    base = vpd_air_sigma_kpa(T, RH, SIGMA_T, SIGMA_RH)
    assert vpd_air_sigma_kpa(T, RH, SIGMA_T * 2, SIGMA_RH) > base
    assert vpd_air_sigma_kpa(T, RH, SIGMA_T, SIGMA_RH * 2) > base


def test_implausible_inputs_are_refused_not_clamped():
    with pytest.raises(ValueError):
        es_kpa(-40.0)
    with pytest.raises(ValueError):
        vpd_air_kpa(T, 120.0)
    with pytest.raises(ValueError):
        vpd_air_kpa(T, -1.0)
    with pytest.raises(ValueError):
        vpd_air_sigma_kpa(T, RH, -0.1, SIGMA_RH)
    with pytest.raises(ValueError):
        vpd_air_sigma_kpa(T, RH, float("nan"), SIGMA_RH)
