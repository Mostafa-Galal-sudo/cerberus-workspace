CREATE TABLE announcement_reads (
  announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (announcement_id, user_id)
);

CREATE TABLE checkpoint_dependencies (
  checkpoint_id TEXT NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
  depends_on_checkpoint_id TEXT NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (checkpoint_id <> depends_on_checkpoint_id),
  PRIMARY KEY (checkpoint_id, depends_on_checkpoint_id)
);

CREATE TABLE assistant_usage (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_characters INTEGER NOT NULL DEFAULT 0,
  output_characters INTEGER NOT NULL DEFAULT 0,
  source_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('completed','failed','rate_limited')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX assistant_usage_user_idx ON assistant_usage(user_id, created_at DESC);

CREATE TABLE report_exports (
  id TEXT PRIMARY KEY,
  requested_by TEXT NOT NULL REFERENCES users(id),
  report_type TEXT NOT NULL,
  filters_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE backup_runs (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id),
  operation TEXT NOT NULL CHECK (operation IN ('export','restore')),
  record_count INTEGER NOT NULL DEFAULT 0,
  checksum TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE integration_settings (
  integration TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  config_json TEXT NOT NULL DEFAULT '{}',
  updated_by TEXT REFERENCES users(id),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO integration_settings (integration, enabled, config_json) VALUES
  ('github', 0, '{}'),
  ('cloudinary', 0, '{}'),
  ('ai', 0, '{"provider":"openai-compatible","model":"gpt-4.1-mini","baseUrl":"https://api.openai.com/v1"}');
