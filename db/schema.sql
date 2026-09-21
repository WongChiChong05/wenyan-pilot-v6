-- Version 1. Run with npm run db:migrate. Separate schema leaves legacy public tables intact.
-- No browser policies: only the privileged server database connection may access data.
CREATE SCHEMA IF NOT EXISTS wenyan;
REVOKE ALL ON SCHEMA wenyan FROM PUBLIC;

CREATE TABLE IF NOT EXISTS wenyan.assignment_lock (id integer PRIMARY KEY CHECK (id = 1));
INSERT INTO wenyan.assignment_lock VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS wenyan.participants (
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  id uuid PRIMARY KEY,
  token uuid NOT NULL UNIQUE,
  delayed_token uuid NOT NULL UNIQUE,
  arm text NOT NULL CHECK (arm IN ('socratic','direct','control')),
  stage text NOT NULL CHECK (stage IN ('S0','S1','S2','S3','S4','S5','S6','DONE')),
  stratum text CHECK (stratum IN ('low','mid','high')),
  pretest_score integer,
  consent_ts timestamptz NOT NULL,
  demographics jsonb NOT NULL,
  exclude_flags jsonb NOT NULL,
  stage_entered_ts jsonb NOT NULL,
  completed_targets jsonb NOT NULL,
  active jsonb,
  delayed_started_ts timestamptz,
  study_config jsonb,
  config_version text NOT NULL,
  version integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS wenyan.responses (
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  id uuid PRIMARY KEY,
  participant_id uuid NOT NULL REFERENCES wenyan.participants(id) ON DELETE RESTRICT,
  stage text NOT NULL CHECK (stage IN ('S1','S3','S5','S6')),
  item_id text NOT NULL,
  level text NOT NULL CHECK (level IN ('check','decode','comprehend','infer')),
  chosen integer CHECK (chosen >= 0),
  correct boolean NOT NULL,
  rt_ms integer NOT NULL CHECK (rt_ms >= 0),
  ts timestamptz NOT NULL,
  config_version text NOT NULL,
  UNIQUE (participant_id, stage, item_id)
);
CREATE TABLE IF NOT EXISTS wenyan.interactions (
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  id uuid PRIMARY KEY,
  participant_id uuid NOT NULL REFERENCES wenyan.participants(id) ON DELETE RESTRICT,
  interaction_id uuid NOT NULL,
  in_target_sentence text,
  granularity text CHECK (granularity IN ('word','sentence','passage')),
  highlight_text text NOT NULL,
  turn_index integer NOT NULL,
  actor text NOT NULL CHECK (actor IN ('system','user')),
  type text NOT NULL,
  text text NOT NULL,
  strategy text CHECK (strategy IN ('A','B','C','D')),
  latency_ms integer,
  raw_response text,
  leak_flags jsonb NOT NULL,
  generated_options jsonb,
  generated_answer_index integer,
  degraded boolean,
  ts timestamptz NOT NULL,
  config_version text NOT NULL
);
CREATE TABLE IF NOT EXISTS wenyan.events (
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  id uuid PRIMARY KEY,
  participant_id uuid NOT NULL REFERENCES wenyan.participants(id) ON DELETE RESTRICT,
  event text NOT NULL,
  payload jsonb NOT NULL,
  ts timestamptz NOT NULL,
  config_version text NOT NULL
);
CREATE TABLE IF NOT EXISTS wenyan.scales (
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  id uuid PRIMARY KEY,
  participant_id uuid NOT NULL UNIQUE REFERENCES wenyan.participants(id) ON DELETE RESTRICT,
  -- Nullable only so pre-v5.5 exports can still be imported without inventing a score.
  -- The v5.5 API requires this field for every new submission.
  mental_effort integer CHECK (mental_effort BETWEEN 1 AND 9),
  load integer CHECK (load BETWEEN 1 AND 7),
  frustration integer CHECK (frustration BETWEEN 1 AND 7),
  self_efficacy integer CHECK (self_efficacy BETWEEN 1 AND 7),
  ts timestamptz NOT NULL,
  config_version text NOT NULL
);
-- Migration from the former three-item 1–7 screen. Historical fields remain nullable
-- so old exports keep their original meaning; new submissions write mental_effort only.
ALTER TABLE wenyan.scales
  ADD COLUMN IF NOT EXISTS mental_effort integer CHECK (mental_effort BETWEEN 1 AND 9);
ALTER TABLE wenyan.scales ALTER COLUMN load DROP NOT NULL;
ALTER TABLE wenyan.scales ALTER COLUMN frustration DROP NOT NULL;
ALTER TABLE wenyan.scales ALTER COLUMN self_efficacy DROP NOT NULL;
CREATE INDEX IF NOT EXISTS participants_stratum_arm ON wenyan.participants(stratum, arm);
CREATE INDEX IF NOT EXISTS interactions_participant ON wenyan.interactions(participant_id, interaction_id, turn_index);
CREATE INDEX IF NOT EXISTS events_participant ON wenyan.events(participant_id, event);
-- responses/scales unique constraints already index participant_id as the leading column.
ALTER TABLE wenyan.assignment_lock ENABLE ROW LEVEL SECURITY;
ALTER TABLE wenyan.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE wenyan.responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE wenyan.interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE wenyan.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE wenyan.scales ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA wenyan FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA wenyan FROM PUBLIC;
