-- v5.7: contact details are separated from research data and deleted after follow-up.
CREATE TABLE IF NOT EXISTS wenyan.participant_contacts (
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  participant_id uuid PRIMARY KEY REFERENCES wenyan.participants(id) ON DELETE RESTRICT,
  email text,
  created_ts timestamptz NOT NULL,
  email_sent_ts timestamptz,
  email_deleted_ts timestamptz,
  config_version text NOT NULL,
  CHECK (
    (email IS NOT NULL AND email_deleted_ts IS NULL)
    OR (email IS NULL AND email_deleted_ts IS NOT NULL)
  )
);

ALTER TABLE wenyan.participant_contacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE wenyan.participant_contacts FROM PUBLIC;
