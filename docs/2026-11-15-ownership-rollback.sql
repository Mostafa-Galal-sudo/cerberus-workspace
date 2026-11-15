-- Rollback for the 2026-11-15 assignment apply. Restores the pre-apply ownership map
-- (checkpoint_1_* -> mostafa, checkpoint_2_* -> wessam, checkpoint_3_* -> khamis)
-- and removes the deputy-admin grant plus the out-of-band audit rows.

UPDATE checkpoints SET owner_id='user_wessam', updated_at=unixepoch()
  WHERE id IN ('checkpoint_2_1','checkpoint_2_2','checkpoint_2_3','checkpoint_2_4','checkpoint_2_5');
UPDATE tasks SET assignee_id='user_wessam', updated_at=unixepoch()
  WHERE id IN ('task_2_1','task_2_2','task_2_3','task_2_4','task_2_5');

UPDATE checkpoints SET owner_id='user_mostafa', updated_at=unixepoch()
  WHERE id='checkpoint_1_1';
UPDATE tasks SET assignee_id='user_mostafa', updated_at=unixepoch()
  WHERE id='task_1_1';

UPDATE checkpoints SET owner_id='user_khamis', updated_at=unixepoch()
  WHERE id IN ('checkpoint_3_1','checkpoint_3_2');
UPDATE tasks SET assignee_id='user_khamis', updated_at=unixepoch()
  WHERE id IN ('task_3_1','task_3_2');

DELETE FROM user_roles WHERE user_id='user_khamis' AND role_id='role_admin';
DELETE FROM audit_logs WHERE metadata_json LIKE '%"appliedVia":"wrangler-d1-cli"%';
