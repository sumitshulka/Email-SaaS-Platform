ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS imported_contact varchar(255);
