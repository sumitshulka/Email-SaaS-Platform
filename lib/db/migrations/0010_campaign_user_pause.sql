ALTER TABLE email_campaigns
  ADD COLUMN IF NOT EXISTS paused_at timestamptz;
