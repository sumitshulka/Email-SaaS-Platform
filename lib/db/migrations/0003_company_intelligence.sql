-- Additive only: company master and tenant contact records are unchanged.
CREATE TABLE IF NOT EXISTS company_research_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  global_company_id uuid NOT NULL REFERENCES global_companies(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  status varchar(20) NOT NULL DEFAULT 'queued',
  stage varchar(40) NOT NULL DEFAULT 'queued',
  depth integer NOT NULL DEFAULT 1,
  credit_cost integer NOT NULL DEFAULT 1,
  settings jsonb NOT NULL,
  provider varchar(20) NOT NULL,
  model varchar(200) NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  web_search_count integer NOT NULL DEFAULT 0,
  source_count integer NOT NULL DEFAULT 0,
  estimated_cost_usd numeric(16,8),
  estimated_cost_inr numeric(16,8),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS company_research_one_active_job ON company_research_jobs(global_company_id) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS company_research_company_created_idx ON company_research_jobs(global_company_id,created_at);
CREATE INDEX IF NOT EXISTS company_research_queue_idx ON company_research_jobs(status,created_at);
CREATE TABLE IF NOT EXISTS company_intelligence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  global_company_id uuid NOT NULL REFERENCES global_companies(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES company_research_jobs(id) ON DELETE CASCADE,
  version integer NOT NULL,
  schema_version varchar(20) NOT NULL DEFAULT '1.0',
  profile jsonb NOT NULL,
  provider varchar(20) NOT NULL,
  model varchar(200) NOT NULL,
  confidence numeric(5,4) NOT NULL,
  source_count integer NOT NULL,
  researched_at timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS company_intelligence_version_unique ON company_intelligence(global_company_id,version);
CREATE UNIQUE INDEX IF NOT EXISTS company_intelligence_job_unique ON company_intelligence(job_id);
CREATE INDEX IF NOT EXISTS company_intelligence_latest_idx ON company_intelligence(global_company_id,researched_at);
