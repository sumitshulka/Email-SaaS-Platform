CREATE TABLE IF NOT EXISTS prospect_value_history (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prospect_id uuid NOT NULL,
  previous_deal_value numeric(20, 4) NOT NULL,
  previous_currency_code varchar(3) NOT NULL,
  new_deal_value numeric(20, 4) NOT NULL,
  new_currency_code varchar(3) NOT NULL,
  changed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prospect_value_history_pkey PRIMARY KEY (id, user_id),
  CONSTRAINT prospect_value_history_prospect_tenant_fk
    FOREIGN KEY (prospect_id, user_id)
    REFERENCES prospects(id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT prospect_value_history_nonnegative
    CHECK (previous_deal_value >= 0 AND new_deal_value >= 0),
  CONSTRAINT prospect_value_history_currency_codes
    CHECK (
      previous_currency_code ~ '^[A-Z]{3}$'
      AND new_currency_code ~ '^[A-Z]{3}$'
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS prospect_value_history_id_unique
  ON prospect_value_history(id);
CREATE INDEX IF NOT EXISTS prospect_value_history_prospect_time_idx
  ON prospect_value_history(user_id, prospect_id, created_at);
