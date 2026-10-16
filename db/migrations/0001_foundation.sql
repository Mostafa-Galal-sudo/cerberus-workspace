PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  specialization TEXT,
  bio TEXT,
  avatar_url TEXT,
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','suspended')),
  password_hash TEXT,
  last_activity_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  archived_at INTEGER
);
CREATE INDEX users_status_idx ON users(status);

CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL
);
CREATE TABLE permissions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL
);
CREATE TABLE role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
CREATE TABLE user_roles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  accepted_at INTEGER,
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX invitations_user_idx ON invitations(user_id, expires_at);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
  user_agent TEXT,
  ip_hash TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  revoked_at INTEGER
);
CREATE INDEX sessions_token_idx ON sessions(token_hash, expires_at);
CREATE INDEX sessions_user_idx ON sessions(user_id, revoked_at);

CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash TEXT NOT NULL,
  attempted_at INTEGER NOT NULL DEFAULT (unixepoch()),
  succeeded INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX login_attempts_key_idx ON login_attempts(key_hash, attempted_at);

CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  archived_at INTEGER
);
CREATE TABLE team_members (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  archived_at INTEGER
);
CREATE TABLE project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  membership_role TEXT NOT NULL DEFAULT 'member',
  PRIMARY KEY (project_id, user_id)
);
CREATE TABLE engineering_domains (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(project_id, name)
);
CREATE TABLE milestones (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  domain_id TEXT REFERENCES engineering_domains(id),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'not_started',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  archived_at INTEGER
);

CREATE TABLE checkpoints (
  id TEXT PRIMARY KEY,
  milestone_id TEXT NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
  owner_id TEXT REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  required_deliverable TEXT NOT NULL DEFAULT '',
  acceptance_criteria TEXT NOT NULL DEFAULT '',
  evidence_requirements TEXT NOT NULL DEFAULT '',
  validation_procedure TEXT NOT NULL DEFAULT '',
  mandatory INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','ready_for_review','approved','changes_requested','blocked','archived')),
  approved_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  archived_at INTEGER
);
CREATE INDEX checkpoints_milestone_idx ON checkpoints(milestone_id, status);
CREATE INDEX checkpoints_owner_idx ON checkpoints(owner_id, status);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  domain_id TEXT REFERENCES engineering_domains(id),
  assignee_id TEXT REFERENCES users(id),
  parent_task_id TEXT REFERENCES tasks(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  prerequisites TEXT NOT NULL DEFAULT '',
  inputs TEXT NOT NULL DEFAULT '',
  implementation_steps TEXT NOT NULL DEFAULT '',
  required_tools TEXT NOT NULL DEFAULT '',
  expected_outputs TEXT NOT NULL DEFAULT '',
  deliverables TEXT NOT NULL DEFAULT '',
  acceptance_criteria TEXT NOT NULL DEFAULT '',
  validation_procedure TEXT NOT NULL DEFAULT '',
  evidence_requirements TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  status TEXT NOT NULL DEFAULT 'backlog' CHECK (status IN ('backlog','in_progress','ready_for_review','approved','blocked','changes_requested','archived')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  approved_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  archived_at INTEGER
);
CREATE INDEX tasks_project_status_idx ON tasks(project_id, status, updated_at DESC);
CREATE INDEX tasks_assignee_status_idx ON tasks(assignee_id, status, updated_at DESC);
CREATE INDEX tasks_domain_idx ON tasks(domain_id, status);

CREATE TABLE checkpoint_tasks (
  checkpoint_id TEXT NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  mandatory INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (checkpoint_id, task_id)
);
CREATE TABLE task_dependencies (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (task_id <> depends_on_task_id),
  PRIMARY KEY (task_id, depends_on_task_id)
);
CREATE INDEX task_dependencies_reverse_idx ON task_dependencies(depends_on_task_id);
CREATE TABLE task_checklist_items (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1,
  completed_at INTEGER,
  completed_by TEXT REFERENCES users(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX checklist_task_idx ON task_checklist_items(task_id, sort_order);

CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id),
  checkpoint_id TEXT REFERENCES checkpoints(id),
  submitted_by TEXT NOT NULL REFERENCES users(id),
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','changes_requested','withdrawn')),
  version INTEGER NOT NULL,
  submitted_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (task_id IS NOT NULL OR checkpoint_id IS NOT NULL)
);
CREATE INDEX submissions_review_queue_idx ON submissions(status, submitted_at);
CREATE INDEX submissions_user_idx ON submissions(submitted_by, submitted_at DESC);
CREATE UNIQUE INDEX submissions_task_version_idx ON submissions(task_id, version) WHERE task_id IS NOT NULL;
CREATE TABLE submission_evidence (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('url','github','attachment','note')),
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  reviewer_id TEXT NOT NULL REFERENCES users(id),
  result TEXT NOT NULL CHECK (result IN ('approved','changes_requested')),
  feedback TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX reviews_submission_idx ON reviews(submission_id, created_at DESC);

CREATE TABLE task_comments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  parent_id TEXT REFERENCES task_comments(id),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER
);
CREATE INDEX task_comments_task_idx ON task_comments(task_id, created_at);

CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  team_id TEXT REFERENCES teams(id),
  name TEXT,
  type TEXT NOT NULL CHECK (type IN ('general','team','direct','task')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  archived_at INTEGER
);
CREATE TABLE channel_members (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (channel_id, user_id)
);
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  parent_id TEXT REFERENCES messages(id),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER
);
CREATE INDEX messages_channel_idx ON messages(channel_id, created_at DESC);
CREATE TABLE message_reads (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE announcements (
  id TEXT PRIMARY KEY, author_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, body TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'all', published_at INTEGER, expires_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()), archived_at INTEGER
);
CREATE TABLE notifications (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, type TEXT NOT NULL,
  title TEXT NOT NULL, body TEXT NOT NULL, resource_type TEXT, resource_id TEXT, read_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX notifications_user_idx ON notifications(user_id, read_at, created_at DESC);
CREATE TABLE worklogs (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), completed_work TEXT NOT NULL,
  current_work TEXT NOT NULL DEFAULT '', problems TEXT NOT NULL DEFAULT '', tests_performed TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL DEFAULT '', next_steps TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()), archived_at INTEGER
);
CREATE INDEX worklogs_user_idx ON worklogs(user_id, created_at DESC);

CREATE TABLE wiki_pages (
  id TEXT PRIMARY KEY, parent_id TEXT REFERENCES wiki_pages(id), title TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL, current_version INTEGER NOT NULL DEFAULT 1, visibility TEXT NOT NULL DEFAULT 'members',
  created_by TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()), archived_at INTEGER
);
CREATE TABLE wiki_versions (
  id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE, version INTEGER NOT NULL,
  content_markdown TEXT NOT NULL, change_summary TEXT NOT NULL DEFAULT '', author_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()), UNIQUE(page_id, version)
);
CREATE TABLE decisions (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), owner_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'proposed', reasoning TEXT NOT NULL, alternatives TEXT NOT NULL DEFAULT '',
  expected_impact TEXT NOT NULL DEFAULT '', supersedes_id TEXT REFERENCES decisions(id), created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()), archived_at INTEGER
);

CREATE TABLE hardware_items (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, model TEXT, serial_number TEXT, quantity INTEGER NOT NULL DEFAULT 1,
  unit_cost REAL, condition TEXT NOT NULL DEFAULT 'good', purchase_status TEXT NOT NULL DEFAULT 'available',
  datasheet_url TEXT, notes TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()), archived_at INTEGER
);
CREATE TABLE hardware_assignments (
  id TEXT PRIMARY KEY, hardware_id TEXT NOT NULL REFERENCES hardware_items(id), holder_id TEXT REFERENCES users(id),
  quantity INTEGER NOT NULL DEFAULT 1, checked_out_at INTEGER NOT NULL DEFAULT (unixepoch()), checked_in_at INTEGER,
  notes TEXT, created_by TEXT NOT NULL REFERENCES users(id)
);
CREATE TABLE experiments (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), owner_id TEXT NOT NULL REFERENCES users(id),
  experiment_code TEXT NOT NULL UNIQUE, title TEXT NOT NULL, objective TEXT NOT NULL, hypothesis TEXT NOT NULL,
  environment TEXT NOT NULL, procedure TEXT NOT NULL, expected_results TEXT NOT NULL DEFAULT '', conclusion TEXT,
  reproducibility TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'draft',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()), archived_at INTEGER
);
CREATE TABLE experiment_runs (
  id TEXT PRIMARY KEY, experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE, run_number INTEGER NOT NULL,
  input_parameters TEXT NOT NULL DEFAULT '{}', actual_results TEXT NOT NULL DEFAULT '', validation_notes TEXT NOT NULL DEFAULT '',
  performed_at INTEGER NOT NULL DEFAULT (unixepoch()), performed_by TEXT NOT NULL REFERENCES users(id), UNIQUE(experiment_id, run_number)
);
CREATE TABLE experiment_results (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES experiment_runs(id) ON DELETE CASCADE, metric_name TEXT NOT NULL,
  value REAL, text_value TEXT, unit TEXT, observed INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE bugs (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), reporter_id TEXT NOT NULL REFERENCES users(id),
  assignee_id TEXT REFERENCES users(id), title TEXT NOT NULL, description TEXT NOT NULL, reproduction_steps TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL DEFAULT 'medium', status TEXT NOT NULL DEFAULT 'open', resolution_notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()), archived_at INTEGER
);
CREATE TABLE blockers (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), reporter_id TEXT NOT NULL REFERENCES users(id),
  assignee_id TEXT REFERENCES users(id), task_id TEXT REFERENCES tasks(id), title TEXT NOT NULL, description TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium', status TEXT NOT NULL DEFAULT 'open', resolution_notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()), resolved_at INTEGER
);
CREATE INDEX blockers_open_idx ON blockers(status, severity, created_at DESC);

CREATE TABLE github_installations (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), repository_full_name TEXT NOT NULL,
  installation_id TEXT, encrypted_token TEXT, status TEXT NOT NULL DEFAULT 'unconfigured',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE github_links (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), resource_type TEXT NOT NULL, resource_id TEXT NOT NULL,
  github_type TEXT NOT NULL, github_id TEXT NOT NULL, url TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(resource_type, resource_id, github_type, github_id)
);
CREATE TABLE github_events (
  id TEXT PRIMARY KEY, installation_id TEXT REFERENCES github_installations(id), delivery_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL, action TEXT, payload_json TEXT NOT NULL, received_at INTEGER NOT NULL DEFAULT (unixepoch()), processed_at INTEGER
);
CREATE TABLE attachments (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), resource_type TEXT NOT NULL, resource_id TEXT NOT NULL,
  storage_type TEXT NOT NULL CHECK (storage_type IN ('cloudinary','external_private_link')), label TEXT NOT NULL,
  url TEXT NOT NULL, public_id TEXT, mime_type TEXT, byte_size INTEGER, visibility TEXT NOT NULL DEFAULT 'members',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()), archived_at INTEGER
);
CREATE TABLE supervisor_feedback (
  id TEXT PRIMARY KEY, supervisor_id TEXT NOT NULL REFERENCES users(id), member_id TEXT NOT NULL REFERENCES users(id),
  resource_type TEXT, resource_id TEXT, body TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX supervisor_feedback_member_idx ON supervisor_feedback(member_id, created_at DESC);

CREATE TABLE progress_events (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), user_id TEXT REFERENCES users(id),
  event_type TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, approved_delta INTEGER NOT NULL DEFAULT 0,
  total_delta INTEGER NOT NULL DEFAULT 0, occurred_at INTEGER NOT NULL DEFAULT (unixepoch()), actor_id TEXT NOT NULL REFERENCES users(id)
);
CREATE INDEX progress_events_user_idx ON progress_events(user_id, occurred_at);
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY, actor_id TEXT REFERENCES users(id), action TEXT NOT NULL, resource_type TEXT NOT NULL,
  resource_id TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', ip_hash TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX audit_logs_resource_idx ON audit_logs(resource_type, resource_id, created_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs(actor_id, created_at DESC);
CREATE TABLE workspace_settings (
  key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_by TEXT REFERENCES users(id), updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO roles (id, name, description) VALUES
  ('role_admin', 'super_admin', 'Full workspace administration'),
  ('role_member', 'team_member', 'Project team member'),
  ('role_supervisor', 'project_supervisor', 'Read and feedback access for academic supervision'),
  ('role_technical_lead', 'technical_lead', 'Technical leadership designation');
INSERT INTO permissions (id, name, description) VALUES
  ('perm_task_manage', 'task.manage', 'Create and edit task definitions'),
  ('perm_task_work', 'task.work', 'Work on assigned tasks'),
  ('perm_review_admin', 'review.admin', 'Administratively approve submissions'),
  ('perm_feedback', 'feedback.create', 'Provide supervisor feedback'),
  ('perm_admin', 'workspace.admin', 'Administer workspace configuration');
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('role_admin','perm_task_manage'), ('role_admin','perm_review_admin'), ('role_admin','perm_admin'),
  ('role_admin','perm_task_work'), ('role_member','perm_task_work'), ('role_supervisor','perm_feedback');
INSERT INTO teams (id, name, description) VALUES ('team_cerberus', 'CERBERUS Engineering', 'Core graduation project team');
INSERT INTO projects (id, name, description) VALUES
  ('project_cerberus', 'CERBERUS', 'Autonomous multi-layer IoT cyber defense and RF resilience platform');
INSERT INTO workspace_settings (key, value_json) VALUES
  ('workspace.name', '"CERBERUS WORKSPACE"'),
  ('assistant.enabled', 'false'),
  ('progress.weighting', '"equal"');
