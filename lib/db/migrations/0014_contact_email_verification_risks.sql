ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS email_verification_risk_flags jsonb,
  ADD COLUMN IF NOT EXISTS email_verification_suggested_email varchar(254);
