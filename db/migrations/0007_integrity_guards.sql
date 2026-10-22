-- Integrity guards for review races, duplicate pending submissions and last-admin safety.

-- A submission is reviewed at most once. Clean up any historical duplicates first.
DELETE FROM reviews
WHERE rowid NOT IN (SELECT MIN(rowid) FROM reviews GROUP BY submission_id);

CREATE UNIQUE INDEX IF NOT EXISTS reviews_submission_unique_idx ON reviews(submission_id);

-- At most one pending submission per task/checkpoint. Withdraw older duplicates.
UPDATE submissions
SET status = 'withdrawn', updated_at = unixepoch()
WHERE status = 'pending' AND rowid NOT IN (
  SELECT MAX(rowid) FROM submissions
  WHERE status = 'pending'
  GROUP BY COALESCE(task_id, ''), COALESCE(checkpoint_id, '')
);

CREATE UNIQUE INDEX IF NOT EXISTS submissions_task_pending_idx ON submissions(task_id)
WHERE task_id IS NOT NULL AND status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS submissions_checkpoint_pending_idx ON submissions(checkpoint_id)
WHERE checkpoint_id IS NOT NULL AND status = 'pending';

CREATE TRIGGER IF NOT EXISTS prevent_last_admin_role_removal
BEFORE DELETE ON user_roles
WHEN OLD.role_id = 'role_admin'
  AND (SELECT COUNT(*) FROM user_roles ur
       JOIN users u ON u.id = ur.user_id
       WHERE ur.role_id = 'role_admin' AND u.status = 'active' AND u.archived_at IS NULL) <= 1
BEGIN
  SELECT RAISE(ABORT, 'LAST_ADMIN');
END;

CREATE TRIGGER IF NOT EXISTS prevent_last_admin_deactivation
BEFORE UPDATE OF status, archived_at ON users
WHEN OLD.status = 'active' AND OLD.archived_at IS NULL
  AND (NEW.status <> 'active' OR NEW.archived_at IS NOT NULL)
  AND EXISTS (SELECT 1 FROM user_roles WHERE user_id = OLD.id AND role_id = 'role_admin')
  AND (SELECT COUNT(*) FROM user_roles ur
       JOIN users u ON u.id = ur.user_id
       WHERE ur.role_id = 'role_admin' AND u.status = 'active' AND u.archived_at IS NULL) <= 1
BEGIN
  SELECT RAISE(ABORT, 'LAST_ADMIN');
END;
