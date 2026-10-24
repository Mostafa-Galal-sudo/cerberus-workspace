-- Phase 1: documentation, experiment run explorer, hardware lifecycle,
-- notification center MVP, and global search.

-- Hardware tracking model. A row is either a quantity-tracked lot or a
-- serialized unit (quantity is forced to 1 by the API). The two models are
-- explicit so quantities are never silently mixed with serialized units.
ALTER TABLE hardware_items ADD COLUMN tracking_mode TEXT NOT NULL DEFAULT 'quantity'
  CHECK (tracking_mode IN ('quantity','serialized'));
ALTER TABLE hardware_items ADD COLUMN min_quantity INTEGER NOT NULL DEFAULT 0
  CHECK (min_quantity >= 0);

-- Condition and accountability are recorded when hardware is returned.
ALTER TABLE hardware_assignments ADD COLUMN condition_on_return TEXT
  CHECK (condition_on_return IN ('new','good','fair','damaged','retired'));
ALTER TABLE hardware_assignments ADD COLUMN return_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE hardware_assignments ADD COLUMN returned_by TEXT REFERENCES users(id);

CREATE INDEX hardware_assignments_item_idx ON hardware_assignments(hardware_id, checked_out_at DESC);
CREATE INDEX hardware_assignments_holder_idx ON hardware_assignments(holder_id, checked_out_at DESC);

CREATE TABLE hardware_maintenance (
  id TEXT PRIMARY KEY,
  hardware_id TEXT NOT NULL REFERENCES hardware_items(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('maintenance','calibration','inspection')),
  performed_by TEXT NOT NULL REFERENCES users(id),
  performed_at INTEGER NOT NULL DEFAULT (unixepoch()),
  next_due_at INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX hardware_maintenance_item_idx ON hardware_maintenance(hardware_id, performed_at DESC);

-- A run may reference the task or checkpoint whose evidence it supports.
ALTER TABLE experiment_runs ADD COLUMN task_id TEXT REFERENCES tasks(id);
ALTER TABLE experiment_runs ADD COLUMN checkpoint_id TEXT REFERENCES checkpoints(id);
CREATE INDEX experiment_runs_task_idx ON experiment_runs(task_id);
CREATE INDEX experiment_runs_checkpoint_idx ON experiment_runs(checkpoint_id);

-- Every notification insert produces a realtime event for its recipient so
-- the unread badge and notification list invalidate through the existing SSE
-- stream. Polling remains the fallback when SSE is unavailable.
CREATE TRIGGER notifications_workspace_event
AFTER INSERT ON notifications
BEGIN
  INSERT INTO workspace_events (event_type, user_id, payload_json)
  VALUES (
    'notification.created',
    NEW.user_id,
    json_object(
      'notificationId', NEW.id,
      'notificationType', NEW.type,
      'resourceType', NEW.resource_type,
      'resourceId', NEW.resource_id
    )
  );
END;
