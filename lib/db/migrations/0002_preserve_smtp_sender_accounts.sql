BEGIN;

-- Move the legacy one-account-per-user table to its UUID identity without
-- dropping or recreating any existing sender rows.
ALTER TABLE public.tenant_sending_configurations
  ADD COLUMN IF NOT EXISTS id uuid;

UPDATE public.tenant_sending_configurations
SET id = gen_random_uuid()
WHERE id IS NULL;

ALTER TABLE public.tenant_sending_configurations
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN id SET NOT NULL;

ALTER TABLE public.tenant_sending_configurations
  ADD COLUMN IF NOT EXISTS is_primary boolean;

UPDATE public.tenant_sending_configurations
SET is_primary = true
WHERE is_primary IS NULL;

ALTER TABLE public.tenant_sending_configurations
  ALTER COLUMN is_primary SET DEFAULT true,
  ALTER COLUMN is_primary SET NOT NULL;

ALTER TABLE public.tenant_sending_configurations
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_at timestamptz;

UPDATE public.tenant_sending_configurations
SET created_at = COALESCE(updated_at, now())
WHERE created_at IS NULL;

ALTER TABLE public.tenant_sending_configurations
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL;

DO $$
DECLARE
  existing_pk_name text;
  existing_pk_columns text[];
BEGIN
  SELECT
    constraint_row.conname,
    array_agg(attribute_row.attname::text ORDER BY key_column.ordinality)
  INTO existing_pk_name, existing_pk_columns
  FROM pg_constraint AS constraint_row
  JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY
    AS key_column(attnum, ordinality) ON true
  JOIN pg_attribute AS attribute_row
    ON attribute_row.attrelid = constraint_row.conrelid
   AND attribute_row.attnum = key_column.attnum
  WHERE constraint_row.conrelid =
    'public.tenant_sending_configurations'::regclass
    AND constraint_row.contype = 'p'
  GROUP BY constraint_row.conname;

  IF existing_pk_columns IS DISTINCT FROM ARRAY['id']::text[] THEN
    IF existing_pk_name IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE public.tenant_sending_configurations DROP CONSTRAINT %I',
        existing_pk_name
      );
    END IF;

    ALTER TABLE public.tenant_sending_configurations
      ADD CONSTRAINT tenant_sending_configurations_pkey PRIMARY KEY (id);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS tenant_sending_configurations_user_idx
  ON public.tenant_sending_configurations (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_sending_configurations_primary_unique
  ON public.tenant_sending_configurations (user_id)
  WHERE is_primary = true;

COMMIT;
