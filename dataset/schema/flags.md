# sensor_flags — bit registry

`sensor_flags` is an int64 bitmask on `readings`. A flag DESCRIBES a known
limitation of a row; it never excuses one. Flags travel with the data forever —
a published row keeps its flags, and downstream consumers decide what to do
with them. The alternative (dropping or "cleaning" flagged rows) is exactly
the over-cleaning the research doc warns against.

Rules:

- Unknown bits are refused at build time, not ignored — an unregistered flag
  is a schema violation (same doctrine as unknown channels at ingest).
- New bits are appended here FIRST, then set in data. The registry is the
  source of truth; code follows it.
- Reserved bits must never appear set. Bit 5 exists precisely so the refusal
  of assumed leaf offsets is visible in the registry.

| bit | value | name                        | meaning |
| --- | ----- | --------------------------- | ------- |
| 0   | 1     | `PH_TREND_ONLY_UNCALIBRATED`| pH from an uncalibrated probe — usable as a trend, refused as an absolute value (matches the mood engine's pH trust of 0) |
| 1   | 2     | `EC_UNCALIBRATED_BAND`      | EC from a factory-cal-only probe — band/tendency quality, not lab quality (trust 0.6 in the mood engine) |
| 2   | 4     | `SUSPECT_SPIKE`             | value jumped implausibly fast vs neighbors; kept raw, flagged instead of smoothed |
| 3   | 8     | `CLOCK_ADJUSTED`            | source timestamp was corrected against server receive time; the adjustment is on record, the original is not silently overwritten |
| 4   | 16    | `GAP_AFTER`                 | the source went dark after this row (>90 min); the gap is real and stays a gap — no interpolation ever fills it |
| 5   | 32    | `ASSUMED_LEAF_OFFSET`       | RESERVED — never set. Leaf VPD from an assumed leaf-air offset is refused outright; `vpd_leaf_kpa` stays NULL until a leaf IR sensor exists |
