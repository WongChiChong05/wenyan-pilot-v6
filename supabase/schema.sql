-- HISTORICAL REFERENCE ONLY. Do not apply this file for the current backend.
-- Use npm run db:migrate with db/schema.sql and src/lib/store.postgres.ts.
-- Existing public tables are not migrated or deleted automatically.

create table participants (
  id uuid primary key,
  token uuid not null unique,
  delayed_token uuid not null unique,
  arm text not null check (arm in ('socratic','direct','control')),
  stage text not null,
  stratum text check (stratum in ('low','mid','high')),
  pretest_score int,
  consent_ts timestamptz not null,
  demographics jsonb not null default '{}',
  exclude_flags text[] not null default '{}',
  stage_entered_ts jsonb not null default '{}',
  completed_targets text[] not null default '{}',
  active jsonb
);

create table responses (
  id uuid primary key,
  participant_id uuid not null references participants(id),
  stage text not null,
  item_id text not null,
  level text not null check (level in ('check','decode','comprehend','infer')),
  chosen int,               -- null = skipped
  correct boolean not null,
  rt_ms int not null,
  ts timestamptz not null
);

create table interactions (
  id uuid primary key,
  participant_id uuid not null references participants(id),
  interaction_id uuid not null,          -- groups the turns of one highlight
  in_target_sentence text,               -- target id, or null for a free highlight
  granularity text check (granularity in ('word','sentence','passage')),
  highlight_text text not null,
  turn_index int not null,
  actor text not null check (actor in ('system','user')),
  type text not null,                    -- question | probe | choice | reject | explain | user
  text text not null,
  strategy text check (strategy in ('A','B','C','D')),
  latency_ms int,
  raw_response text,                     -- full model response, for the manipulation check
  leak_flags text[] not null default '{}',
  ts timestamptz not null
);

create table events (
  id uuid primary key,
  participant_id uuid not null references participants(id),
  event text not null,
  payload jsonb not null default '{}',
  ts timestamptz not null
);

create table scales (
  id uuid primary key,
  participant_id uuid not null references participants(id),
  load int not null check (load between 1 and 7),
  frustration int not null check (frustration between 1 and 7),
  self_efficacy int not null check (self_efficacy between 1 and 7),
  ts timestamptz not null
);

create index on responses (participant_id, stage);
create index on interactions (participant_id, interaction_id, turn_index);
create index on events (participant_id, event);
