ALTER TABLE tenant_sending_configurations
  ADD COLUMN IF NOT EXISTS authentication_method varchar(32) NOT NULL DEFAULT 'password';
CREATE TABLE IF NOT EXISTS microsoft_sender_connections (
  account_id uuid PRIMARY KEY REFERENCES tenant_sending_configurations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mailbox varchar(254) NOT NULL,
  client_id varchar(100) NOT NULL,
  access_token_encrypted text NOT NULL,
  refresh_token_encrypted text NOT NULL,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS microsoft_sender_user_idx ON microsoft_sender_connections(user_id);
CREATE TABLE IF NOT EXISTS microsoft_sender_states (
  nonce varchar(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES tenant_sending_configurations(id) ON DELETE CASCADE,
  session_hash varchar(64) NOT NULL,
  verifier_encrypted text NOT NULL,
  configuration_fingerprint varchar(64) NOT NULL,
  sender_fingerprint varchar(64) NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS microsoft_sender_states_expiry_idx ON microsoft_sender_states(expires_at);
ALTER TABLE microsoft_sender_states ADD COLUMN IF NOT EXISTS session_hash varchar(64) NOT NULL DEFAULT '';
ALTER TABLE microsoft_sender_states ALTER COLUMN session_hash DROP DEFAULT;
