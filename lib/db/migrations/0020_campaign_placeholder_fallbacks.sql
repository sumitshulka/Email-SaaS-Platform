ALTER TABLE email_campaigns
  ADD COLUMN IF NOT EXISTS placeholder_fallbacks jsonb NOT NULL DEFAULT '{}'::jsonb;
