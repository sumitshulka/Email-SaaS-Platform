ALTER TABLE subscription_packages ADD COLUMN IF NOT EXISTS open_campaign_allowance integer NOT NULL DEFAULT 0;
ALTER TABLE subscription_packages ADD COLUMN IF NOT EXISTS open_campaign_recipient_limit integer NOT NULL DEFAULT 0;
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS audience_type varchar(16) NOT NULL DEFAULT 'standard';
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS open_campaign_subscription_id uuid REFERENCES user_subscriptions(id) ON DELETE RESTRICT;
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS open_campaign_counted_at timestamptz;
CREATE INDEX IF NOT EXISTS email_campaigns_open_term_idx ON email_campaigns(user_id, open_campaign_subscription_id);
CREATE TABLE IF NOT EXISTS open_campaign_audience (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  email varchar(254) NOT NULL,
  first_name varchar(100) NOT NULL DEFAULT '',
  last_name varchar(100) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS open_campaign_audience_email_unique ON open_campaign_audience(campaign_id,email);
CREATE INDEX IF NOT EXISTS open_campaign_audience_owner_idx ON open_campaign_audience(user_id,campaign_id);
CREATE TABLE IF NOT EXISTS campaign_email_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email varchar(254) NOT NULL,
  reason varchar(24) NOT NULL DEFAULT 'unsubscribed',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_email_suppressions_owner_email_unique ON campaign_email_suppressions(user_id,email);
