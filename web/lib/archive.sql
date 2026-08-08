create table if not exists raw_readings (
  id bigserial primary key,
  source_token text not null,
  ts bigint not null,
  channels jsonb not null,
  meta jsonb,
  raw jsonb not null,
  received_at timestamptz default now(),
  unique (source_token, ts)
);
