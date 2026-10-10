ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS email_status varchar(20);

UPDATE contacts
SET email_status = CASE WHEN subscribed THEN 'subscribed' ELSE 'unsubscribed' END
WHERE email_status IS NULL;

UPDATE contacts AS c
SET subscribed = false,
    email_status = 'bounced',
    updated_at = now()
WHERE EXISTS (
  SELECT 1
  FROM email_campaign_recipients AS r
  WHERE r.contact_id = c.id
    AND r.user_id = c.user_id
    AND lower(r.email) = lower(c.email)
    AND r.report_outcome = 'bounced'
)
AND c.email_status = 'subscribed';
