ALTER TABLE users
  ADD COLUMN IF NOT EXISTS
    password_reset_token_hash TEXT;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS
    password_reset_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS
  idx_users_password_reset_token_hash
  ON users (password_reset_token_hash);
