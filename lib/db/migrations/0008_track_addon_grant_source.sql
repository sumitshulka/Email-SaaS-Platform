ALTER TABLE add_on_entitlements
  ADD COLUMN IF NOT EXISTS grant_source text NOT NULL DEFAULT 'purchase';

DROP INDEX IF EXISTS add_on_entitlements_free_claim_unique;

CREATE UNIQUE INDEX IF NOT EXISTS add_on_entitlements_free_claim_unique
  ON add_on_entitlements (user_id, package_id)
  WHERE payment_id IS NULL AND grant_source <> 'admin_gift';
