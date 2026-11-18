ALTER TABLE subscription_packages
  ADD COLUMN IF NOT EXISTS prospect_management_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reports_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS personal_report_limit integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'subscription_packages_personal_report_limit_nonnegative'
      AND conrelid = 'subscription_packages'::regclass
  ) THEN
    -- Preserve the report experience for existing accounts while moving
    -- control of each package's future allowance to the admin console.
    UPDATE subscription_packages
    SET
      prospect_management_enabled = amount_minor > 0,
      reports_enabled = true,
      personal_report_limit = 10000
    WHERE package_type = 'primary';

    ALTER TABLE subscription_packages
      ADD CONSTRAINT subscription_packages_personal_report_limit_nonnegative
      CHECK (personal_report_limit >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'subscription_packages_free_prospect_management_disabled'
      AND conrelid = 'subscription_packages'::regclass
  ) THEN
    ALTER TABLE subscription_packages
      ADD CONSTRAINT subscription_packages_free_prospect_management_disabled
      CHECK (amount_minor > 0 OR prospect_management_enabled = false);
  END IF;
END
$$;
