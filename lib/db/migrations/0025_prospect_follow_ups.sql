CREATE TABLE IF NOT EXISTS prospect_follow_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prospect_id uuid NOT NULL,
  action_type_id uuid NOT NULL,
  follow_up_date date NOT NULL,
  notes text NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'pending',
  completed_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prospect_follow_ups_prospect_tenant_fk
    FOREIGN KEY (prospect_id, user_id) REFERENCES prospects(id, user_id) ON DELETE CASCADE,
  CONSTRAINT prospect_follow_ups_type_tenant_fk
    FOREIGN KEY (action_type_id, user_id) REFERENCES prospect_action_types(id, user_id),
  CONSTRAINT prospect_follow_ups_status_valid
    CHECK (status IN ('pending', 'completed', 'cancelled')),
  CONSTRAINT prospect_follow_ups_notes_nonempty
    CHECK (length(trim(notes)) > 0),
  CONSTRAINT prospect_follow_ups_completion_time
    CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS prospect_follow_ups_user_date_status_idx
  ON prospect_follow_ups(user_id, follow_up_date, status);
CREATE INDEX IF NOT EXISTS prospect_follow_ups_prospect_date_idx
  ON prospect_follow_ups(user_id, prospect_id, follow_up_date);
