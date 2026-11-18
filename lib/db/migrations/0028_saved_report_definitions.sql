CREATE TABLE IF NOT EXISTS saved_report_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(160) NOT NULL,
  description varchar(1000) NOT NULL DEFAULT '',
  category varchar(80) NOT NULL DEFAULT 'Custom',
  base_entity_id varchar(80) NOT NULL,
  definition jsonb NOT NULL,
  definition_version integer NOT NULL DEFAULT 1,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saved_report_definitions_name_valid
    CHECK (length(trim(name)) BETWEEN 1 AND 160),
  CONSTRAINT saved_report_definitions_version_valid
    CHECK (definition_version >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS saved_report_definitions_user_name_unique
  ON saved_report_definitions (user_id, lower(name));

CREATE INDEX IF NOT EXISTS saved_report_definitions_user_updated_idx
  ON saved_report_definitions (user_id, updated_at);
