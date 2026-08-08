# Dataset schema — six tables

The modular ingest door (`web/lib/ingest.ts`, envelope v1) IS this dataset's
intake: envelope channels map 1:1 to `readings` columns. Uncertainty is
first-class, not a footnote — every table that carries a measurement carries
the columns that say how much to trust it. Two standing refusals shape every
column here:

- **No imputation, ever.** `is_imputed` exists so the refusal is auditable:
  it is always `false`, and the ETL hard-fails on any row where it isn't.
  Gaps are flagged (`GAP_AFTER`), never filled.
- **Derived values are versioned.** VPD (and its sigma) exist only in ETL
  output, stamped with `derivation_version`. Published rows never mutate; a
  formula change is a new version, not an edit.

Shared uncertainty columns (present on `readings`, mirrored where noted):

| column               | type   | meaning |
| -------------------- | ------ | ------- |
| `sensor_flags`       | int64  | bitmask, bit registry in [flags.md](flags.md); unknown bits are refused at build time |
| `is_imputed`         | bool   | always `false` — we refuse imputation; the column exists to prove it row by row |
| `calibration_status` | string | `raw` \| `factory` \| `user` — how the source sensor was calibrated (`raw` = uncharacterized, e.g. Tuya; `factory` = vendor cal, e.g. THCPH-S; `user` = co-location-calibrated) |
| `qc_status`          | string | `unverified` \| `verified` — `verified` is the hand-checked gold tier; everything lands `unverified` (wild) |
| `derivation_version` | string | ETL version that produced the derived columns of this row (e.g. `vpd-tetens-v1`) |

## readings

Tall timeseries, one row per source sample. Soil channels come from the
THCPH-S probe, air channels from the Tuya T/H sensor (and later SHT4x);
a row carries only the channels its source actually measured — the rest are
NULL, which is absence, not imputation.

| column              | type    | notes |
| ------------------- | ------- | ----- |
| `plant_id`          | string  | FK → plants |
| `device_id`         | string  | FK → devices (the source that took the sample) |
| `ts_utc_ms`         | int64   | epoch milliseconds, UTC; SNTP-gated at the node — a 1970 clock is refused at ingest, never "fixed" here |
| `air_temp_c`        | float64 | NULL on soil-only rows |
| `rh_pct`            | float64 | NULL on soil-only rows |
| `soil_moisture_pct` | float64 | NULL on air-only rows |
| `soil_temp_c`       | float64 | NULL on air-only rows |
| `soil_ec_ms_cm`     | float64 | mS/cm (node converts µS/cm ÷1000); trust-graded, see flag bit 1 |
| `soil_ph`           | float64 | trend-only until user calibration, see flag bit 0 |
| `vpd_air_kpa`       | float64 | DERIVED in ETL only (Tetens, `etl/vpd.py`); NULL when air_temp_c or rh_pct is NULL |
| `vpd_air_sigma_kpa` | float64 | propagated 1-sigma error bar; populated once device sigmas exist (SHT4x co-location, Wave 4) — NULL until then, never guessed |
| `vpd_leaf_kpa`      | float64 | stays NULL until a leaf IR sensor exists — an assumed leaf-air offset is refused (flag bit 5 is reserved, never set) |
| `ingest_source`     | string  | `live` \| `backfill` (`backfill` = Thales.xlsx importer rows) |
| `sensor_flags`      | int64   | see above |
| `is_imputed`        | bool    | see above |
| `calibration_status`| string  | see above |
| `qc_status`         | string  | see above |
| `derivation_version`| string  | see above |

Annex (gated, NOT in v0 builds): `biopot_mv` joins only after a co-located
ground-truth study proves the cheap electrode carries signal — per the
research doc, that transfer is the biggest unproven leap.

## plants

One row per enrolled plant. Enrollment opens an outcome; **enrollment must
close** — the ETL hard-fails on a plant with no closed outcome, which is the
anti-survivorship-bias mechanism (deaths get logged, not forgotten).

| column        | type   | notes |
| ------------- | ------ | ----- |
| `plant_id`    | string | stable pseudonymous id |
| `label`       | string | human name (e.g. "Thalesadão") |
| `species`     | string | GBIF-resolvable name; "unspecified" is a legal value (cannabis caution) |
| `cultivar`    | string | normalized vocabulary; NULL if unknown |
| `medium`      | string | soil / coco / hydro / … |
| `light`       | string | fixture + photoperiod description |
| `stage`       | string | `vega` \| `flora` \| `single` — bands are stage-aware (Thales.xlsx proves the operation already is) |
| `coarse_geo`  | string | Köppen class or coarse region ONLY — never fine geolocation, never joinable to a grower |
| `grower_id`   | string | random pseudonym, opt-in |
| `enrolled_at` | int64  | epoch ms; opens the outcome clock |
| `closed_at`   | int64  | epoch ms; NULL only while the plant is actively enrolled |

## events

Grower actions and observations — waterings, feeds, the whole care record.
Payloads are per-kind JSON; an event states what was done, never what the
sensors should have shown.

| column       | type   | notes |
| ------------ | ------ | ----- |
| `event_id`   | string | unique |
| `plant_id`   | string | FK → plants |
| `ts_utc_ms`  | int64  | epoch ms |
| `kind`       | string | `water` \| `feed` \| `prune` \| `defoliate` \| `wound` \| `flip` \| `harvest` \| `death` \| `health_check` \| `note` |
| `payload`    | string | JSON per kind (e.g. feed: `{ml, ec_in}`; health_check: `{health_0_5}` per the rubric in `logs/outcomes.yaml`) |
| `source`     | string | `manual` \| `inferred` — inferred = detectEvents from soil jumps; manual is authoritative on conflict |

## outcomes

The label that makes the dataset science instead of telemetry. One open
outcome per enrollment; weekly health checks per the 0–5 rubric
(`logs/outcomes.yaml`); closing requires an end state — including `death`.

| column         | type   | notes |
| -------------- | ------ | ----- |
| `outcome_id`   | string | unique |
| `plant_id`     | string | FK → plants |
| `opened_at`    | int64  | epoch ms == plants.enrolled_at |
| `closed_at`    | int64  | epoch ms; NULL only while open — ETL hard-fails a build containing a closed plant with an open outcome |
| `health_0_5`   | int64  | latest weekly score, rubric-pinned |
| `yield_g_dry`  | float64| NULL until harvest |
| `yield_source` | string | `self` \| `verified` |
| `death_bool`   | bool   | true when the outcome closed with a death |
| `death_cause`  | string | free text + taxonomy tag; NULL when alive |

## devices

What took the measurement, and why we trust it as much as we do. Calibration
lives here so a `readings` row's `calibration_status` is auditable against
the device that produced it.

| column               | type   | notes |
| -------------------- | ------ | ----- |
| `device_id`          | string | stable id (e.g. `thcphs-01`, `tuya-th-01`) |
| `model`              | string | e.g. `ComWinTop THCPH-S`, `Tuya T/H` |
| `channels`           | string | JSON list of channel names this device claims |
| `calibration_status` | string | `raw` \| `factory` \| `user` |
| `calibration_coeffs` | string | JSON (offsets/scales + sigmas from co-location); NULL until characterized |
| `firmware`           | string | e.g. `plant-node-0.1` |
| `shielding_bool`     | bool   | matters for the biopotential annex; false for env sensors |

## photos

Interop with the vision ecosystem, and the evidence leg of health checks.

| column          | type   | notes |
| --------------- | ------ | ----- |
| `photo_id`      | string | unique |
| `plant_id`      | string | FK → plants |
| `ts_utc_ms`     | int64  | epoch ms |
| `uri`           | string | repo-relative path or content-addressed key |
| `exif_stripped` | bool   | must be true before publication — EXIF carries fine geolocation, which we never ship |
| `qc_status`     | string | `unverified` \| `verified` |
