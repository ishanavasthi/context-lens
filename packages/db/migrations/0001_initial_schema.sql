-- Initial schema for ContextLens: users, devices, sessions, urls, events, screenshots.

create table users (
  user_id uuid primary key,
  email text unique not null,
  created_at timestamptz not null default now()
);

create table devices (
  device_id uuid primary key,
  user_id uuid not null references users on delete cascade,
  user_agent text,
  platform text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table sessions (
  session_id text primary key,
  device_id uuid not null references devices on delete cascade,
  user_id uuid not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  consent_scopes text[] not null
);

create table urls (
  url_id bigserial primary key,
  url_hash bytea unique not null,
  scheme text,
  host text,
  path text,
  title text
);

create table events (
  event_id text primary key,
  session_id text not null references sessions on delete cascade,
  user_id uuid not null,
  type text not null,
  ts timestamptz not null,
  seq int not null,
  tab_id int,
  url_id bigint references urls,
  payload jsonb not null default '{}',
  ingested_at timestamptz not null default now()
);

create table screenshots (
  screenshot_id text primary key,
  event_id text references events on delete cascade,
  user_id uuid not null,
  storage_path text not null,
  width int,
  height int,
  dpr real,
  bytes int,
  sha256 bytea
);

create index events_user_id_ts_idx on events (user_id, ts desc);
create index events_session_id_seq_idx on events (session_id, seq);
create index events_user_id_type_ts_idx on events (user_id, type, ts desc);
create index events_payload_gin_idx on events using gin (payload);
