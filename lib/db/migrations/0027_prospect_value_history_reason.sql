ALTER TABLE prospect_value_history
  ADD COLUMN IF NOT EXISTS reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'prospect_value_history_reason_valid'
      AND conrelid = 'public.prospect_value_history'::regclass
  ) THEN
    ALTER TABLE prospect_value_history
      ADD CONSTRAINT prospect_value_history_reason_valid
      CHECK (reason IS NULL OR length(trim(reason)) BETWEEN 3 AND 4000);
  END IF;
END $$;
