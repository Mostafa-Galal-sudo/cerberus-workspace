-- Complete module support: realtime event delivery, R2-backed attachments,
-- and an auditable email delivery ledger.

CREATE TABLE workspace_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX workspace_events_user_idx ON workspace_events(user_id, seq);
CREATE INDEX workspace_events_created_idx ON workspace_events(created_at);

CREATE TABLE email_outbox (
  id TEXT PRIMARY KEY,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent','failed','skipped')),
  error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX email_outbox_created_idx ON email_outbox(created_at DESC);

-- SQLite cannot widen a CHECK constraint in place. Rebuild the attachments
-- table so private R2 objects and checksummed evidence are first-class.
CREATE TABLE attachments_new (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  storage_type TEXT NOT NULL CHECK (storage_type IN ('cloudinary','external_private_link','r2')),
  label TEXT NOT NULL,
  filename TEXT,
  url TEXT NOT NULL,
  public_id TEXT,
  mime_type TEXT,
  byte_size INTEGER,
  checksum_sha256 TEXT,
  visibility TEXT NOT NULL DEFAULT 'members',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  archived_at INTEGER
);
INSERT INTO attachments_new
  (id, owner_id, resource_type, resource_id, storage_type, label, filename, url, public_id, mime_type, byte_size, visibility, created_at, archived_at, checksum_sha256)
SELECT id, owner_id, resource_type, resource_id, storage_type, label, NULL, url, public_id, mime_type, byte_size, visibility, created_at, archived_at, NULL
FROM attachments;
DROP TABLE attachments;
ALTER TABLE attachments_new RENAME TO attachments;
CREATE INDEX attachments_resource_idx ON attachments(resource_type, resource_id, archived_at);
CREATE INDEX attachments_owner_idx ON attachments(owner_id, created_at DESC);
