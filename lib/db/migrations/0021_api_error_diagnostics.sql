CREATE TABLE IF NOT EXISTS api_error_diagnostics (
  id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  method varchar(10) NOT NULL,
  path varchar(255) NOT NULL,
  status_code integer NOT NULL,
  error_name varchar(160) NOT NULL,
  root_error_name varchar(160),
  error_code varchar(40),
  database_schema varchar(128),
  database_table varchar(128),
  database_column varchar(128),
  database_constraint varchar(128),
  error_message text,
  stack_trace text
);

CREATE INDEX IF NOT EXISTS api_error_diagnostics_occurred_at_idx
  ON api_error_diagnostics (occurred_at DESC);

CREATE INDEX IF NOT EXISTS api_error_diagnostics_path_idx
  ON api_error_diagnostics (path, occurred_at DESC);
