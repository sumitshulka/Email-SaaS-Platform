ALTER TABLE ai_email_assist_usages
  ALTER COLUMN entitlement_id DROP NOT NULL;

ALTER TABLE ai_email_assist_usages
  ADD COLUMN IF NOT EXISTS subscription_id uuid
  REFERENCES user_subscriptions(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ai_email_assist_usage_source_valid'
      AND conrelid = 'public.ai_email_assist_usages'::regclass
  ) THEN
    ALTER TABLE ai_email_assist_usages
      ADD CONSTRAINT ai_email_assist_usage_source_valid
      CHECK (
        (entitlement_id IS NOT NULL AND subscription_id IS NULL)
        OR (entitlement_id IS NULL AND subscription_id IS NOT NULL)
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS ai_email_assist_usage_subscription_idx
  ON ai_email_assist_usages (subscription_id);
