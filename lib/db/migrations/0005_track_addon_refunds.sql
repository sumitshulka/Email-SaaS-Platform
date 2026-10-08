ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS refunded_amount_minor integer NOT NULL DEFAULT 0;
