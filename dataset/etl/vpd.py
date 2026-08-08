"""Vapor-pressure deficit — derived in versioned ETL, never stored raw.

Saturation vapor pressure over liquid water, Tetens (1930):

    es(T) = 0.61078 * exp(17.27 * T / (T + 237.3))    [kPa, T in deg C]

Alternative Magnus-form coefficient sets exist — notably Alduchov & Eskridge
(1996), who recommend a = 0.61094 kPa, b = 17.625, c = 243.04 degC for better
relative error over -40..50 degC. We pin the classic Tetens constants and
VERSION the choice: adopting a different coefficient set is a new
DERIVATION_VERSION applied in a new build, never a silent edit to published
rows.

Air VPD:

    vpd_air(T, RH) = es(T) * (1 - RH/100)             [kPa]

Leaf VPD is deliberately absent: it stays NULL in the dataset until a leaf IR
sensor exists. An assumed leaf-air offset is refused (schema/flags.md bit 5 is
reserved, never set).

Uncertainty — first-order propagation, independent sigma_T and sigma_RH:

    d(es)/dT  = es(T) * b*c / (T + c)^2
    dVPD/dT   = d(es)/dT * (1 - RH/100)
    dVPD/dRH  = -es(T) / 100
    sigma_vpd = sqrt((dVPD/dT * sigma_T)^2 + (dVPD/dRH * sigma_RH)^2)

Worked example pinned in test_vpd.py: SHT41-class sigma_T = 0.2 degC,
sigma_RH = 1.8 %RH at 25 degC / 60 %RH -> sigma_vpd ~= 0.06 kPa. That error
bar travels with every VPD value we publish.
"""

import math

DERIVATION_VERSION = "vpd-tetens-v1"

# Tetens (1930) coefficients, over liquid water.
TETENS_A_KPA = 0.61078  # saturation vapor pressure at 0 degC
TETENS_B = 17.27  # dimensionless
TETENS_C_DEGC = 237.3  # temperature offset

# Plausibility rails for a grow environment. Out-of-range input is refused,
# not clamped — a clamped VPD is a lie every downstream model would train on.
TEMP_PLAUSIBLE_C = (-20.0, 60.0)
RH_PLAUSIBLE_PCT = (0.0, 100.0)


def _require_finite(name: str, value: float) -> None:
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
        raise ValueError(f"{name} must be a finite number, got {value!r}")


def _require_plausible(name: str, value: float, lo: float, hi: float) -> None:
    _require_finite(name, value)
    if value < lo or value > hi:
        raise ValueError(f"{name}={value} out of plausible range {lo}..{hi}")


def es_kpa(temp_c: float) -> float:
    """Saturation vapor pressure [kPa] at temp_c [degC], Tetens over water."""
    _require_plausible("temp_c", temp_c, *TEMP_PLAUSIBLE_C)
    return TETENS_A_KPA * math.exp(TETENS_B * temp_c / (temp_c + TETENS_C_DEGC))


def des_dt_kpa_per_c(temp_c: float) -> float:
    """d(es)/dT [kPa/degC] — the temperature sensitivity used in propagation."""
    _require_plausible("temp_c", temp_c, *TEMP_PLAUSIBLE_C)
    return es_kpa(temp_c) * TETENS_B * TETENS_C_DEGC / (temp_c + TETENS_C_DEGC) ** 2


def vpd_air_kpa(temp_c: float, rh_pct: float) -> float:
    """Air VPD [kPa] from air temperature [degC] and relative humidity [%]."""
    _require_plausible("rh_pct", rh_pct, *RH_PLAUSIBLE_PCT)
    return es_kpa(temp_c) * (1.0 - rh_pct / 100.0)


def vpd_air_sigma_kpa(temp_c: float, rh_pct: float, sigma_t_c: float, sigma_rh_pct: float) -> float:
    """Propagated 1-sigma uncertainty of vpd_air_kpa [kPa].

    Assumes independent errors on T and RH. Zero sigmas yield exactly zero —
    certainty in, certainty out; anything else would be invented error.
    """
    _require_plausible("rh_pct", rh_pct, *RH_PLAUSIBLE_PCT)
    _require_finite("sigma_t_c", sigma_t_c)
    _require_finite("sigma_rh_pct", sigma_rh_pct)
    if sigma_t_c < 0 or sigma_rh_pct < 0:
        raise ValueError("sigmas must be non-negative")
    dvpd_dt = des_dt_kpa_per_c(temp_c) * (1.0 - rh_pct / 100.0)
    dvpd_drh = -es_kpa(temp_c) / 100.0
    return math.sqrt((dvpd_dt * sigma_t_c) ** 2 + (dvpd_drh * sigma_rh_pct) ** 2)
