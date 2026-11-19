CREATE TABLE IF NOT EXISTS basic_plan_support_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  milestone integer NOT NULL,
  free_package_id uuid NOT NULL REFERENCES subscription_packages(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending',
  requested_at timestamptz NOT NULL DEFAULT now(),
  decision_deadline_at timestamptz NOT NULL,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  rejection_reason text,
  grant_subscription_id uuid REFERENCES user_subscriptions(id) ON DELETE SET NULL,
  paid_window_started_at timestamptz,
  CONSTRAINT basic_plan_support_request_milestone_check CHECK (milestone BETWEEN 1 AND 3),
  CONSTRAINT basic_plan_support_request_status_check CHECK (status IN ('pending', 'approved', 'auto_approved', 'rejected')),
  CONSTRAINT basic_plan_support_request_deadline_check CHECK (decision_deadline_at > requested_at),
  CONSTRAINT basic_plan_support_request_resolution_check CHECK (
    (status = 'pending' AND resolved_at IS NULL AND resolved_by IS NULL AND rejection_reason IS NULL AND grant_subscription_id IS NULL)
    OR (status = 'rejected' AND resolved_at IS NOT NULL AND rejection_reason IS NOT NULL AND grant_subscription_id IS NULL)
    OR (status IN ('approved', 'auto_approved') AND resolved_at IS NOT NULL AND grant_subscription_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS basic_plan_support_request_user_milestone_unique
  ON basic_plan_support_requests (user_id, milestone);
CREATE UNIQUE INDEX IF NOT EXISTS basic_plan_support_request_one_pending_per_user
  ON basic_plan_support_requests (user_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS basic_plan_support_request_queue_idx
  ON basic_plan_support_requests (status, decision_deadline_at);
CREATE INDEX IF NOT EXISTS basic_plan_support_request_user_idx
  ON basic_plan_support_requests (user_id, requested_at);
