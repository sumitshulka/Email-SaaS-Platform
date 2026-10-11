ALTER TABLE email_campaigns
  ADD COLUMN IF NOT EXISTS resume_at timestamptz;

CREATE INDEX IF NOT EXISTS email_campaigns_resume_at_idx
  ON email_campaigns (resume_at)
  WHERE resume_at IS NOT NULL;
