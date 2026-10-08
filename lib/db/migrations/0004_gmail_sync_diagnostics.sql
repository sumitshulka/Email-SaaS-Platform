ALTER TABLE public.gmail_mailbox_connections
  ADD COLUMN IF NOT EXISTS last_sync_diagnostics jsonb;
