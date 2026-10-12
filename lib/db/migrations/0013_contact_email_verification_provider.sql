ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS email_verification_provider varchar(80),
  ADD COLUMN IF NOT EXISTS email_verification_method varchar(120);
