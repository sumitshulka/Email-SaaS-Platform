CREATE TABLE IF NOT EXISTS public.razorpay_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  razorpay_refund_id varchar(80) NOT NULL,
  amount_minor integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS razorpay_refund_provider_id_unique
  ON public.razorpay_refunds (razorpay_refund_id);

CREATE INDEX IF NOT EXISTS razorpay_refund_payment_idx
  ON public.razorpay_refunds (payment_id);
