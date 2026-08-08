# Event log

Manual care events land here as one YAML file per month (`2026-08.yaml`),
each a flat list feeding the `events` table. An event records what the
grower DID — never what the sensors should have shown. The server also
infers `water`/`feed` events from soil jumps (`source: inferred`); on
conflict the manual record is authoritative, and both are kept.

Kinds: `water` · `feed` · `prune` · `defoliate` · `wound` · `flip` ·
`harvest` · `death` · `health_check` · `note`

Entry template:

```yaml
- event_id: evt-2026-08-001
  plant_id: plant-001
  ts: 2026-08-15T14:30:00-03:00   # local time with offset; ETL converts to UTC ms
  kind: feed
  payload: { ml: 500, ec_in: 1.4 }
  source: manual
```

`health_check` payloads carry `{ health_0_5, photo_id }` scored against the
rubric in `../outcomes.yaml` — same number, same photo, both places.
