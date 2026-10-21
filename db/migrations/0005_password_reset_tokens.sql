-- One-time administrative password reset links.
-- Plaintext tokens are never stored: only their SHA-256 digest is persisted.
CREATE TABLE password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens(user_id, created_at DESC);
