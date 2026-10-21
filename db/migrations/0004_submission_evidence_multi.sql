-- Allow multiple evidence records per submission.
-- The original table declared submission_id UNIQUE, which silently capped every
-- submission at a single evidence row while the API accepts up to 20.
CREATE TABLE submission_evidence_new (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('url','github','attachment','note')),
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO submission_evidence_new (id, submission_id, kind, label, value, created_at)
  SELECT id, submission_id, kind, label, value, created_at FROM submission_evidence;

DROP TABLE submission_evidence;
ALTER TABLE submission_evidence_new RENAME TO submission_evidence;
CREATE INDEX submission_evidence_submission_idx ON submission_evidence(submission_id);

-- Prevent duplicate version numbers when two checkpoint submissions race.
CREATE UNIQUE INDEX submissions_checkpoint_version_idx ON submissions(checkpoint_id, version) WHERE checkpoint_id IS NOT NULL;
