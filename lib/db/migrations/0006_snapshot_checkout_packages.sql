ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS package_snapshot jsonb;
