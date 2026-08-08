# Plant Wars — Deep Research Report (Front C: the scientific moat + public open dataset)

*Hugging Face landscape, plant-sensing & electrophysiology literature, and the design of a crowd-sourced public open dataset. 28 agents, adversarial verification guarding against hallucinated HF repos and citations. Research only. Note: named repos/papers are agent-surfaced and verifier-checked, but spot-check arXiv IDs before relying on any single citation.*

---

## STRATEGY — the open-dataset play

### (a) The scientific white space
What exists is abundant and the wrong shape: leaf-**disease image** sets are saturated (mohanty/PlantVillage + 30+ near-duplicate forks); VPD is a settled formula; wound signaling is nailed-down biology (Toyota 2018, Mousavi 2013). **Sensor-timeseries barely exists** — a few small, single-site, partly-synthetic greenhouse tables plus the elite Wageningen Autonomous Greenhouse Challenge (telemetry→yield, a handful of research glasshouses). Plant **biosignal** data is real but siloed in tiny single-lab Zenodo/figshare drops in incompatible WAV/Excel formats. **What is genuinely missing:** one open, real-world, crowd-sourced corpus fusing per-plant environmental timeseries (VPD/temp/RH/soil/leaf-IR) + biopotential + a documented **grow outcome**. That intersection is empty everywhere (HF, Zenodo, Kaggle, Mendeley). Defensible because outcome-labeling + data-hygiene is the unglamorous work that has kept everyone out — and only an installed probe fleet produces it at scale.

### (b) Real science or vanity?
**Real — if sequenced honestly.** VPD+outcome from a calibrated SHT4x is low-risk and immediately useful; PurpleAir/Safecast proved cheap crowd sensors become citable science *after* co-location calibration. Biosignal is high-risk: published positive electrophysiology results (88–95% accuracy) used **lab electrodes on 16–36 plants**. The leap from Toyota's *fluorescence-imaged* Ca²⁺ wave to a $15 INA333 reading in a humid tent is the biggest unproven step. **De-risk:** narrow first (VPD → outcome), treat biopotential as a clearly-flagged experimental annex, promote it only after a co-located ground-truth study.

### (c) The flywheel (deepest moat)
Crowd probes → harmonized HF dataset + data-descriptor paper → better forecasting/coaching models → better in-product LLM advice → more units claim subdomains → more data. It compounds twice: proprietary-then-public data **plus** community goodwill (contributor credit in the paper). No incumbent — HF has *zero* plant-sensor/biosignal **models**, and "VPD" as a namespace is unclaimed.

### (d) Three concrete moves
1. **CanopyAir-Seed v0** — 10-plant hand-verified VPD+temp+RH+outcome dataset, CC-BY-4.0, with a Datasheet-for-Datasets + Croissant metadata + Zenodo DOI. *Credible:* mirrors Cannlytics (CC-BY, honest "non-random" caveat) and GROW Observatory. *1-wk validation:* publish it; measure downloads/likes/citational reach.
2. **VPD→outcome benchmark task** — a leaderboard split (48h stress / plant-death early-warning AUC), *whole-grower held out* to avoid PlantVillage-style overfitting. *Credible:* copies the Autonomous Greenhouse Challenge format. *1-wk:* post the task card + a gradient-boosting baseline (beats DL on small noisy signals).
3. **Cannlytics COA join spec** — schema linking grow telemetry → final potency/quality via strain key. *Credible:* Cannlytics is real (~730k COAs, CC-BY-4.0). *1-wk:* publish a joinable strain-vocabulary crosswalk.

### (e) Risks (speculative marked *)
- **Label/sensor noise:** capacitive soil + unshielded INA333 are artifact-heavy; carry calibration coeffs, firmware IDs, uncertainty columns, and a "Research Grade" tier (eBird/iNat model).
- **Cannabis-legal exposure:** opt-in only, zero PII, coarse geohash/Köppen only — never a joinable grower-location registry. Separate consent for biopotential.
- **Contributor drop-off\*:** GROW Observatory died when grant funding ended; the product loop (subdomain + coaching) must be the incentive, not altruism.
- **Over-promising a paper\*:** ship a modest data-descriptor first; MIT OpenAg's hype-without-reproducible-data collapse is the anti-pattern.
- **Survivorship bias:** growers log wins, not deaths — actively solicit failure/death labels.

**Bottom line:** lead with boring, calibratable VPD+outcome; treat biosignal as a flagged frontier. That sequencing is both the credible science and the honesty-over-woo brand.

---

## HUGGING FACE + LITERATURE LANDSCAPE

### What exists on HF / in the wild
**Leaf-image disease (SATURATED).** `mohanty/PlantVillage` — canonical (verifier correction: ~54k unique images in 3 variants, CC-BY-SA-3.0, *not* the "163k" first claimed) + 30+ near-duplicate forks. `shi-labs/Agriculture-Vision` (aerial). The abundant pole — static images, controlled lighting, zero live sensing.

**Sensor-timeseries (THIN, single-site).** `Okyanus/greenhouse-sensor-data` (18,414 rows, CC-BY-4.0 — the *only* HF set with a VPD column; part-synthetic, derived from the Autonomous Greenhouse Challenge). `GS-2004/Smart-Greenhouse-Telemetry` (5k, synthetic), `AyaYmohamed/smart-greenhouse-forecasting` (10.1k). Soil: `it4lia/soil_moisture_dataset` (358k, CC-BY-NC-ND). Gold standard off-HF: the **Autonomous Greenhouse Challenge** (4TU, telemetry→yield).

**Biosignal (RARE).** On HF the whole category is one acoustic set: `NonSittinon/plant_stress_sounds` (400 clips, Apache-2.0, single species). Real electrophysiology sits off-HF in tiny single-lab Zenodo drops (Venus-flytrap burn CC-BY-4.0; potential+impedance CC-BY-4.0; an open ivy PhytoNode 5-month set). *[Spot-check these DOIs/IDs before citing.]*

**Outcome proxy.** `cannlytics/cannabis_results` — lab COAs, CC-BY-4.0 (verifier: ~729,948 rows; the companion `cannabis_strains` is currently empty). End-of-pipeline only, no grow telemetry.

**Reusable, never plant-tuned.** Generic time-series foundation models (TimesFM, Chronos, MOMENT — Apache/MIT) and crowd precedents (iNaturalist/GBIF, 500M+ obs) are real and ready but never pretrained on plant-sensor data.

### The gap
No dataset anywhere fuses (1) multivariate per-plant environmental telemetry incl. VPD, (2) biopotential/wound electrophysiology, and (3) documented grow outcomes — least of all crowd-sourced across many grows. Leaf **images abundant**; **sensor-timeseries barely exists** (small, often-synthetic, single-facility); **biosignal at scale is empty** (every set tiny, single-lab, single-species, siloed in ad-hoc formats). The intersection is the whitespace; **outcome-labeling is the hard, defensible part.**

*Verifier corrections folded in:* PlantVillage size/license, Cannlytics row count + empty strains table, and a mis-attributed Zenodo author list were all corrected; anything unconfirmable was dropped.

---

## PUBLIC DATASET DESIGN

**The gap (real, empty):** no open dataset fuses environment time-series + biopotential + grower actions + verified outcomes. First-of-its-kind — but the absence also reflects *difficulty (quality)*, not just neglect.

### Schema (multi-config Parquet, Croissant, grouped/time splits)
- **readings** (tall timeseries): ts; env (air_temp, RH, **vpd_kpa** derived, leaf-VPD, CO2/PPFD opt); soil (VWC/EC/temp/pH opt); leaf_temp + leaf-air delta; bio (biopot_mv, event_flag). **1 sample/60s** env, opt-in ~30-min high-rate biosignal bursts.
- **plants**: species (GBIF), cultivar/strain (normalized vocab), medium, light, photoperiod, coarse geohash.
- **events**: water/feed/prune/defoliate/wound-burn/flip/harvest/**death** + payload.
- **outcomes**: yield_g_dry, yield_source (self/verified), health 0–5, death_bool+cause.
- **devices**: sensor models + calibration coeffs, shielding bool.
- **photos**: interop with the vision ecosystem.

**Honest-uncertainty columns (first-class):** sensor_flags bitmask, is_imputed, calibration_status (raw/factory/user), firmware, and a **propagated vpd_uncertainty_kpa** so every VPD carries an error bar. Ship **two tiers:** small human-verified "gold" + large noisy "wild," same schema.

### Governance
- **First-party opt-in only, off by default** (avoids the scraped-data licensing trap).
- **Cannabis caution:** ZERO precise geolocation/PII; coarse region/Köppen + random pseudonym; never a joinable grower-location registry; "unspecified" plant-type option; separate consent for biopotential; right-to-delete.
- **License:** CC-BY-4.0 data (matches Cannlytics), MIT/Apache firmware+schema, DUA banning re-identification.
- **Hosting:** HF Datasets, git versioning, auto-Croissant, Dataset Card + **Datasheet/Data-Statement** + companion **data-descriptor preprint** + frozen Zenodo DOI v1.

### Contributor incentives
Leaderboard by **data-quality/uptime (not volume)** to deter spam; badges (Calibrated, Research Grade, Contributed to vX); "you advanced plant science" count + opt-in acknowledgment; free premium for verified growers; each device's public page shows its stats.

### Data→model flywheel (VPD-first, biosignals-last)
1. **Phase 1 (ship now):** VPD/env → outcome. First-ever plant-sensor time-series model on HF: VPD forecaster + plant-death early-warning, feeding in-product coaching. Classical features + AutoML/gradient-boosting (beats DL on small noisy signals).
2. **Phase 2:** per-strain optimal-VPD; leaderboard task (48h stress/death-risk AUC) mirroring the WUR Challenge; Ag-ML/Climate-ML workshop paper.
3. **Phase 3 (gated):** biosignal stress classifier — only after a co-located ground-truth study proves the cheap electrode carries signal.

**Realistic first output:** an HF dataset card + benchmark + workshop paper on **plant-death early-warning / VPD forecasting** from calibrated crowd env data.

### Honest risks
Self-reported yields noisy; capacitive soil probes drift; unshielded INA333 biopotentials artifact-heavy; heterogeneous devices; **survivorship bias** (deaths under-logged); severe class imbalance; single-grower overfitting (the PlantVillage failure mode). Toyota-2018 biology is real but measured by fluorescence, not a $15 electrode — that transfer is the biggest unproven leap. **De-risk:** keep raw+flags (don't over-clean), carry uncertainty everywhere, hold out *whole growers* in test splits, gate scientific claims to the gold tier, and publicly disown "plants read emotions" woo. Credibility lives in the calibration/verification columns.
