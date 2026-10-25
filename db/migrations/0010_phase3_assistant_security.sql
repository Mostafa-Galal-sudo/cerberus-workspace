-- Phase 3: persistent assistant threads with retrieval citations, audited
-- read-only tools, and account security (sessions, login history, TOTP MFA).

CREATE TABLE assistant_threads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  archived_at INTEGER
);
CREATE INDEX assistant_threads_user_idx ON assistant_threads(user_id, updated_at DESC)
  WHERE archived_at IS NULL;

CREATE TABLE assistant_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES assistant_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  citations_json TEXT NOT NULL DEFAULT '[]',
  tool_runs_json TEXT NOT NULL DEFAULT '[]',
  provider TEXT,
  model TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX assistant_messages_thread_idx ON assistant_messages(thread_id, created_at);

ALTER TABLE assistant_usage ADD COLUMN thread_id TEXT;
CREATE INDEX assistant_usage_thread_idx ON assistant_usage(thread_id) WHERE thread_id IS NOT NULL;

CREATE TABLE user_mfa (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  method TEXT NOT NULL DEFAULT 'totp' CHECK (method = 'totp'),
  secret TEXT NOT NULL,
  confirmed_at INTEGER,
  last_used_step INTEGER,
  recovery_codes_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE login_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  ip_hash TEXT NOT NULL,
  user_agent TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX login_challenges_user_idx ON login_challenges(user_id, created_at DESC);

CREATE TABLE login_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  success INTEGER NOT NULL CHECK (success IN (0, 1)),
  method TEXT NOT NULL CHECK (method IN ('password', 'mfa', 'recovery_code')),
  reason TEXT,
  ip_hash TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX login_events_user_idx ON login_events(user_id, created_at DESC);
