-- Phase 2: task scheduling and effort, review governance, notification
-- preferences and digests, and persisted GitHub pull-request / CI state.

ALTER TABLE tasks ADD COLUMN start_date INTEGER;
ALTER TABLE tasks ADD COLUMN due_date INTEGER;
ALTER TABLE tasks ADD COLUMN estimate_hours REAL NOT NULL DEFAULT 0
  CHECK (estimate_hours >= 0 AND estimate_hours <= 10000);

CREATE INDEX tasks_due_idx ON tasks(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX tasks_assignee_due_idx ON tasks(assignee_id, due_date) WHERE due_date IS NOT NULL;

CREATE TABLE task_worklogs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  worked_on TEXT NOT NULL CHECK (worked_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  hours REAL NOT NULL CHECK (hours > 0 AND hours <= 24),
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX task_worklogs_task_idx ON task_worklogs(task_id, worked_on DESC);
CREATE INDEX task_worklogs_user_idx ON task_worklogs(user_id, worked_on DESC);

CREATE TABLE review_rubrics (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(name)
);

CREATE TABLE review_rubric_criteria (
  id TEXT PRIMARY KEY,
  rubric_id TEXT NOT NULL REFERENCES review_rubrics(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  weight REAL NOT NULL CHECK (weight > 0 AND weight <= 100),
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(rubric_id, label)
);
CREATE INDEX review_rubric_criteria_rubric_idx ON review_rubric_criteria(rubric_id, sort_order);

ALTER TABLE submissions ADD COLUMN assigned_reviewer_id TEXT REFERENCES users(id);
ALTER TABLE submissions ADD COLUMN assigned_by TEXT REFERENCES users(id);
ALTER TABLE submissions ADD COLUMN assigned_at INTEGER;
ALTER TABLE submissions ADD COLUMN rubric_id TEXT REFERENCES review_rubrics(id);

CREATE INDEX submissions_reviewer_idx ON submissions(assigned_reviewer_id, status, submitted_at)
  WHERE assigned_reviewer_id IS NOT NULL;

ALTER TABLE reviews ADD COLUMN rubric_id TEXT REFERENCES review_rubrics(id);
ALTER TABLE reviews ADD COLUMN scores_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE reviews ADD COLUMN total_score REAL;

CREATE TABLE notification_preferences (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('task', 'review', 'collaboration', 'account', 'digest')),
  in_app INTEGER NOT NULL DEFAULT 1 CHECK (in_app IN (0, 1)),
  email INTEGER NOT NULL DEFAULT 0 CHECK (email IN (0, 1)),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, category)
);

CREATE TABLE notification_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  digest_frequency TEXT NOT NULL DEFAULT 'off' CHECK (digest_frequency IN ('off', 'daily', 'weekly')),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE notification_digests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'emailed', 'skipped', 'failed')),
  email_status TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX notification_digests_user_idx ON notification_digests(user_id, created_at DESC);

CREATE TABLE github_pull_requests (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  repository TEXT NOT NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed', 'merged')),
  draft INTEGER NOT NULL DEFAULT 0 CHECK (draft IN (0, 1)),
  head_ref TEXT,
  base_ref TEXT,
  head_sha TEXT,
  checks_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (checks_status IN ('unknown', 'pending', 'success', 'failure', 'neutral')),
  checks_json TEXT NOT NULL DEFAULT '{}',
  merged_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(repository, number)
);
CREATE INDEX github_pull_requests_state_idx ON github_pull_requests(repository, state, updated_at DESC);
CREATE INDEX github_pull_requests_sha_idx ON github_pull_requests(repository, head_sha);

CREATE TABLE github_pull_request_tasks (
  pull_request_id TEXT NOT NULL REFERENCES github_pull_requests(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  linked_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (pull_request_id, task_id)
);
CREATE INDEX github_pull_request_tasks_task_idx ON github_pull_request_tasks(task_id);
