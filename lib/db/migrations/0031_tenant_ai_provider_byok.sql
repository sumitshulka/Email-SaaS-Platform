ALTER TABLE subscription_packages
  ADD COLUMN IF NOT EXISTS byok_ai_enabled boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'subscription_packages_byok_ai_primary_only'
      AND conrelid = 'subscription_packages'::regclass
  ) THEN
    ALTER TABLE subscription_packages
      ADD CONSTRAINT subscription_packages_byok_ai_primary_only
      CHECK (package_type = 'primary' OR byok_ai_enabled = false);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS tenant_ai_provider_configurations (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider varchar(20) NOT NULL CHECK (provider IN ('openai', 'anthropic', 'gemini')),
  api_key_encrypted text NOT NULL,
  selected_model varchar(200) NOT NULL,
  last_tested_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
