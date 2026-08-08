# Plant Node firmware

ESPHome firmware for the Plant Faces sensor node: a WROOM-32 reads the
ComWinTop THCPH-S soil probe (moisture / soil temp / EC / pH) over RS485 via a
MAX485, and POSTs the exact `web/lib/ingest.ts` wire body every 15 minutes.

**The bench contract — wiring table, RO divider, register-discovery protocol,
pre-power checklist, Lab notes — lives in
[`home-automations/builds/plant-node.md`](../../home-automations/builds/plant-node.md).**
That doc is the truth about the hardware; this directory is only the code half.
Do not wire, power, or flash anything without it open.

## Quickstart

```sh
# 1. Secrets — copy the template, fill in wifi + token + ingest URL.
#    secrets.yaml is gitignored; it never leaves the desk.
cp secrets.yaml.example secrets.yaml

# 2. Validate + compile (no hardware needed)
esphome config plant-node.yaml
esphome compile plant-node.yaml

# 3. Flash over USB (first flash must be wired; pick the node's serial port)
esphome run plant-node.yaml

# 4. Watch logs — this IS the register-discovery instrument (T1.2):
#    sensor states print at DEBUG, so plausibility checks read straight off it.
esphome logs plant-node.yaml
```

No local `esphome`? `uvx esphome run plant-node.yaml` (or `pipx run esphome …`)
works without installing anything.

## Bench protocol (short form — the builds doc has the full version)

1. Wire per the table in the builds doc; desk-eyes photo review BEFORE power.
2. Flash, watch logs. Silence → 9600 baud → swap A/B → ≥9V probe supply, in
   that order.
3. Sanity anchors: soil temp ≈ room ±3 °C (grip the probe — it must warm),
   moisture in air ≈ 0–5, EC in air ≈ 0, tap-water glass decides the pH scale
   (reads ~70 → change the pH multiply to 0.01; reads ~7 → keep 0.1).
4. Record ACTUAL baud/addr/registers/scales in the builds doc's Lab notes and
   correct every ⚠ BENCH-VERIFY comment in `plant-node.yaml` to reality.
5. Smoke chain: point `ingest_url` at webhook.site (byte-shape check: six keys,
   13-digit `ts`, no auth header) → local dev 202 → prod 202 → face reacts.

## Honesty notes

- **The device token sits in flash and is extractable** by anyone with the
  board in hand. That is deliberate: it is a low-privilege source token that
  can only post readings for its one plant — never an account credential.
  Losing the board costs one token mint, nothing more.
- **No clamping, ever.** The firmware applies documented unit scales
  (×0.1 °C, µS→mS) and nothing else; a glitched reading ships raw and the
  server 400s it. The node's only response to a 400 is to try again next cycle.
- **FC03 reads only.** The probe has writable calibration registers; this
  firmware never issues a write.
