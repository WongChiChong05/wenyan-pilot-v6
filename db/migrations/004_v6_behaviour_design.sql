-- v6.0: behaviour-change design. New stages (S1b, S5b, S5a), three training passages,
-- and one row per translated sentence. Old stage values stay legal so v5.x rows remain valid.
ALTER TABLE wenyan.participants DROP CONSTRAINT IF EXISTS participants_stage_check;
ALTER TABLE wenyan.participants ADD CONSTRAINT participants_stage_check
  CHECK (stage IN ('S0','S1','S1b','S2','S3','S4','S5','S5a','S5b','S6','DONE'));
ALTER TABLE wenyan.participants ADD COLUMN IF NOT EXISTS progress jsonb;

ALTER TABLE wenyan.responses DROP CONSTRAINT IF EXISTS responses_stage_check;
ALTER TABLE wenyan.responses ADD CONSTRAINT responses_stage_check
  CHECK (stage IN ('S1','S3','S5','S5b','S6'));

ALTER TABLE wenyan.interactions ADD COLUMN IF NOT EXISTS passage_id text;

CREATE TABLE IF NOT EXISTS wenyan.translations (
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  id uuid PRIMARY KEY,
  participant_id uuid NOT NULL REFERENCES wenyan.participants(id) ON DELETE RESTRICT,
  stage text NOT NULL CHECK (stage IN ('S1b','S5a','S5b')),
  item_id text NOT NULL,
  text text NOT NULL,
  skipped boolean NOT NULL,
  timed_out boolean NOT NULL,
  tried_first boolean NOT NULL,
  first_input_ms integer CHECK (first_input_ms >= 0),
  first_help_kind text CHECK (first_help_kind IN ('hint','explanation','skip')),
  first_help_ms integer CHECK (first_help_ms >= 0),
  draft_at_first_help text,
  hint_ms integer CHECK (hint_ms >= 0),
  explanation_ms integer CHECK (explanation_ms >= 0),
  submit_ms integer NOT NULL CHECK (submit_ms >= 0),
  ts timestamptz NOT NULL,
  config_version text NOT NULL,
  UNIQUE (participant_id, stage, item_id)
);
ALTER TABLE wenyan.translations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE wenyan.translations FROM PUBLIC;
