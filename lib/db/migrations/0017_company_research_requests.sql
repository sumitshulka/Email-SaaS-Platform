CREATE TABLE IF NOT EXISTS company_research_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  global_company_id uuid NOT NULL REFERENCES global_companies(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  research_job_id uuid REFERENCES company_research_jobs(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'in_progress', 'completed', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS company_research_request_one_open_per_user
  ON company_research_requests(global_company_id, requested_by)
  WHERE status IN ('requested', 'in_progress');
CREATE INDEX IF NOT EXISTS company_research_request_queue_idx
  ON company_research_requests(status, created_at);
CREATE INDEX IF NOT EXISTS company_research_request_user_idx
  ON company_research_requests(requested_by, global_company_id, created_at);
CREATE INDEX IF NOT EXISTS company_research_request_job_idx
  ON company_research_requests(research_job_id);
