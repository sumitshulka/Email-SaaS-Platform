ALTER TABLE prospect_products
  ADD COLUMN IF NOT EXISTS item_type varchar(16) NOT NULL DEFAULT 'product';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'prospect_products_item_type_valid'
  ) THEN
    ALTER TABLE prospect_products
      ADD CONSTRAINT prospect_products_item_type_valid
      CHECK (item_type IN ('product', 'service'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS prospect_product_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prospect_product_categories_name_nonempty CHECK (length(trim(name)) > 0),
  CONSTRAINT prospect_product_categories_pkey PRIMARY KEY (id, user_id),
  CONSTRAINT prospect_product_categories_id_unique UNIQUE (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS prospect_product_categories_user_name_unique
  ON prospect_product_categories(user_id, lower(name));

INSERT INTO prospect_product_categories (user_id, name)
SELECT DISTINCT user_id, trim(category)
FROM prospect_products
WHERE category IS NOT NULL
  AND length(trim(category)) > 0
  AND lower(trim(category)) NOT IN (
    'software & saas',
    'hardware & equipment',
    'professional services',
    'consulting',
    'implementation',
    'training',
    'support & maintenance',
    'managed services',
    'marketing',
    'financial services',
    'office supplies',
    'other'
  )
ON CONFLICT DO NOTHING;
