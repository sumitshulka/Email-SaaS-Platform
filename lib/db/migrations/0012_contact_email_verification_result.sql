ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS email_verification_status varchar(24),
  ADD COLUMN IF NOT EXISTS email_verification_checked_at timestamptz;
