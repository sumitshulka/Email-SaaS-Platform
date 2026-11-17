CREATE TABLE IF NOT EXISTS prospect_products (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(160) NOT NULL,
  description text NOT NULL DEFAULT '',
  category varchar(100),
  active boolean NOT NULL DEFAULT true,
  display_order smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prospect_products_name_nonempty CHECK (length(trim(name)) > 0),
  CONSTRAINT prospect_products_pkey PRIMARY KEY (id, user_id),
  CONSTRAINT prospect_products_id_unique UNIQUE (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS prospect_products_user_name_unique
  ON prospect_products(user_id, lower(name));
CREATE INDEX IF NOT EXISTS prospect_products_user_active_order_idx
  ON prospect_products(user_id, active, display_order);

CREATE TABLE IF NOT EXISTS prospect_currencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code varchar(3) NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prospect_currencies_iso_code CHECK (code ~ '^[A-Z]{3}$'),
  CONSTRAINT prospect_currencies_id_user_unique UNIQUE (id, user_id),
  CONSTRAINT prospect_currencies_user_code_unique UNIQUE (user_id, code)
);
CREATE UNIQUE INDEX IF NOT EXISTS prospect_currencies_one_default_per_user
  ON prospect_currencies(user_id) WHERE is_default;
CREATE INDEX IF NOT EXISTS prospect_currencies_user_default_idx
  ON prospect_currencies(user_id, is_default);

CREATE TABLE IF NOT EXISTS prospect_stages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  description text NOT NULL DEFAULT '',
  probability smallint NOT NULL,
  stage_type varchar(16) NOT NULL DEFAULT 'active',
  terminal_outcome varchar(80),
  display_order smallint NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prospect_stages_name_nonempty CHECK (length(trim(name)) > 0),
  CONSTRAINT prospect_stages_probability_range CHECK (probability BETWEEN 0 AND 100),
  CONSTRAINT prospect_stages_type_valid CHECK (stage_type IN ('active', 'terminal')),
  CONSTRAINT prospect_stages_terminal_outcome CHECK (
    (stage_type = 'active' AND terminal_outcome IS NULL) OR
    (stage_type = 'terminal' AND length(trim(coalesce(terminal_outcome, ''))) > 0)
  ),
  CONSTRAINT prospect_stages_pkey PRIMARY KEY (id, user_id),
  CONSTRAINT prospect_stages_id_unique UNIQUE (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS prospect_stages_user_name_unique
  ON prospect_stages(user_id, lower(name));
CREATE INDEX IF NOT EXISTS prospect_stages_user_active_order_idx
  ON prospect_stages(user_id, active, display_order);

CREATE TABLE IF NOT EXISTS prospect_stage_transitions (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_stage_id uuid NOT NULL,
  to_stage_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prospect_stage_transitions_from_tenant_fk
    FOREIGN KEY (from_stage_id, user_id) REFERENCES prospect_stages(id, user_id),
  CONSTRAINT prospect_stage_transitions_to_tenant_fk
    FOREIGN KEY (to_stage_id, user_id) REFERENCES prospect_stages(id, user_id),
  CONSTRAINT prospect_stage_transition_unique UNIQUE (user_id, from_stage_id, to_stage_id),
  CONSTRAINT prospect_stage_transition_not_self CHECK (from_stage_id <> to_stage_id)
);
CREATE INDEX IF NOT EXISTS prospect_stage_transitions_from_idx
  ON prospect_stage_transitions(user_id, from_stage_id);

CREATE TABLE IF NOT EXISTS prospect_action_types (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  description text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  display_order smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prospect_action_types_name_nonempty CHECK (length(trim(name)) > 0),
  CONSTRAINT prospect_action_types_pkey PRIMARY KEY (id, user_id),
  CONSTRAINT prospect_action_types_id_unique UNIQUE (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS prospect_action_types_user_name_unique
  ON prospect_action_types(user_id, lower(name));
CREATE INDEX IF NOT EXISTS prospect_action_types_user_active_order_idx
  ON prospect_action_types(user_id, active, display_order);

CREATE TABLE IF NOT EXISTS prospects (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL,
  name varchar(180) NOT NULL,
  product_id uuid NOT NULL,
  expected_deal_value numeric(20,4) NOT NULL,
  currency_code varchar(3) NOT NULL,
  expected_closure_date date NOT NULL,
  current_stage_id uuid NOT NULL,
  current_probability smallint NOT NULL,
  notes text NOT NULL,
  actual_closure_date date,
  closure_outcome varchar(80),
  closure_remarks text,
  archived_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prospects_contact_tenant_fk
    FOREIGN KEY (contact_id, user_id) REFERENCES contacts(id, user_id) ON DELETE RESTRICT,
  CONSTRAINT prospects_product_tenant_fk
    FOREIGN KEY (product_id, user_id) REFERENCES prospect_products(id, user_id),
  CONSTRAINT prospects_stage_tenant_fk
    FOREIGN KEY (current_stage_id, user_id) REFERENCES prospect_stages(id, user_id),
  CONSTRAINT prospects_name_nonempty CHECK (length(trim(name)) > 0),
  CONSTRAINT prospects_value_nonnegative CHECK (expected_deal_value >= 0),
  CONSTRAINT prospects_probability_range CHECK (current_probability BETWEEN 0 AND 100),
  CONSTRAINT prospects_currency_code CHECK (currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT prospects_notes_nonempty CHECK (length(trim(notes)) > 0),
  CONSTRAINT prospects_pkey PRIMARY KEY (id, user_id),
  CONSTRAINT prospects_id_unique UNIQUE (id)
);
CREATE INDEX IF NOT EXISTS prospects_user_active_updated_idx
  ON prospects(user_id, archived_at, updated_at);
CREATE INDEX IF NOT EXISTS prospects_contact_idx
  ON prospects(user_id, contact_id, archived_at);
CREATE INDEX IF NOT EXISTS prospects_stage_idx
  ON prospects(user_id, current_stage_id, archived_at);
CREATE INDEX IF NOT EXISTS prospects_close_date_idx
  ON prospects(user_id, expected_closure_date);

CREATE TABLE IF NOT EXISTS prospect_stage_history (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prospect_id uuid NOT NULL,
  event_type varchar(16) NOT NULL,
  previous_stage_id uuid,
  new_stage_id uuid NOT NULL,
  previous_probability smallint,
  new_probability smallint NOT NULL,
  reason text,
  notes_snapshot text,
  changed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prospect_stage_history_prospect_tenant_fk
    FOREIGN KEY (prospect_id, user_id) REFERENCES prospects(id, user_id) ON DELETE CASCADE,
  CONSTRAINT prospect_stage_history_previous_tenant_fk
    FOREIGN KEY (previous_stage_id, user_id) REFERENCES prospect_stages(id, user_id),
  CONSTRAINT prospect_stage_history_new_tenant_fk
    FOREIGN KEY (new_stage_id, user_id) REFERENCES prospect_stages(id, user_id),
  CONSTRAINT prospect_stage_history_event_type CHECK (event_type IN ('created', 'stage_change')),
  CONSTRAINT prospect_stage_history_probabilities CHECK (
    (previous_probability IS NULL OR previous_probability BETWEEN 0 AND 100) AND
    new_probability BETWEEN 0 AND 100
  ),
  CONSTRAINT prospect_stage_history_reason_required CHECK (
    event_type = 'created' OR length(trim(coalesce(reason, ''))) > 0
  ),
  CONSTRAINT prospect_stage_history_pkey PRIMARY KEY (id, user_id),
  CONSTRAINT prospect_stage_history_id_unique UNIQUE (id)
);
CREATE INDEX IF NOT EXISTS prospect_stage_history_prospect_time_idx
  ON prospect_stage_history(user_id, prospect_id, created_at);

CREATE TABLE IF NOT EXISTS prospect_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prospect_id uuid NOT NULL,
  action_type_id uuid NOT NULL,
  stage_history_id uuid NOT NULL,
  action_date date NOT NULL,
  notes text NOT NULL,
  recorded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prospect_actions_prospect_tenant_fk
    FOREIGN KEY (prospect_id, user_id) REFERENCES prospects(id, user_id) ON DELETE CASCADE,
  CONSTRAINT prospect_actions_type_tenant_fk
    FOREIGN KEY (action_type_id, user_id) REFERENCES prospect_action_types(id, user_id),
  CONSTRAINT prospect_actions_stage_period_tenant_fk
    FOREIGN KEY (stage_history_id, user_id) REFERENCES prospect_stage_history(id, user_id) ON DELETE CASCADE,
  CONSTRAINT prospect_actions_notes_nonempty CHECK (length(trim(notes)) > 0)
);
CREATE INDEX IF NOT EXISTS prospect_actions_prospect_date_idx
  ON prospect_actions(user_id, prospect_id, action_date);
CREATE INDEX IF NOT EXISTS prospect_actions_stage_period_idx
  ON prospect_actions(user_id, stage_history_id, action_date);

CREATE TABLE IF NOT EXISTS prospect_tag_assignments (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prospect_id uuid NOT NULL,
  tag_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prospect_tag_assignments_prospect_tenant_fk
    FOREIGN KEY (prospect_id, user_id) REFERENCES prospects(id, user_id) ON DELETE CASCADE,
  CONSTRAINT prospect_tag_assignments_tag_tenant_fk
    FOREIGN KEY (tag_id, user_id) REFERENCES contact_tags(id, user_id) ON DELETE CASCADE,
  CONSTRAINT prospect_tag_assignment_unique UNIQUE (user_id, prospect_id, tag_id)
);
CREATE INDEX IF NOT EXISTS prospect_tag_filter_idx
  ON prospect_tag_assignments(user_id, tag_id, prospect_id);
