ALTER TABLE email_campaigns
  ADD COLUMN IF NOT EXISTS excluded_contact_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[];
