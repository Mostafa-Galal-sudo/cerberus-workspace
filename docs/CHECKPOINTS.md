# Implementation checkpoints

## WS-01 — Foundation and database

Status: implemented and locally verifiable.

- React/Vite application and Cloudflare Worker are served as one deployment.
- D1 migration defines identity, projects, roadmaps, review workflows, communication, documentation, inventory, experiments, GitHub metadata, progress, and audit foundations.
- Initializer creates seven identities with unique temporary passwords, six member roadmaps, thirty checkpoints, thirty actionable seed tasks, required checklist items, and acyclic dependency chains.
- Temporary credentials are disclosed once and must remain in a gitignored private file; no password is stored in source control.

## WS-02 — Authentication and role access

Status: first production-oriented slice implemented.

- Forced first-login password replacement, optional one-time invitation activation, PBKDF2 password hashing, opaque server-side sessions, HttpOnly cookies, CSRF verification, rate limiting, logout, role and permission checks, session revocation on suspension, and audit records.
- Mostafa is one identity with member, technical lead, and super-admin roles; the interface switches modes without duplicating the account.
- Account recovery and invitation reissue UI remain to be implemented.

## WS-03 — Members, teams, and roadmap

Status: database and seed workflow implemented; administrative editing UI is incomplete.

- All members, specializations, project membership, team membership, engineering domains, roadmaps, checkpoints, tasks, checklists, and dependency chains are persisted.
- Member listing and suspension API exists.
- Team reassignment, profile editing, invitation reissue, and full permissions UI remain.

## WS-04 — Tasks and approval workflow

Status: core vertical slice and interactive Kanban implemented and verifiable.

- Paginated task listing/search/filter, detail records, required checklists, dependency enforcement, versioned evidence submissions, independent administrative review, self-approval prevention, notifications, audit events, and progress events.
- Interactive 4-column drag-and-drop Kanban board (`todo`, `in_progress`, `submitted`, `blocked`), optimistic cache updates, failure rollback, keyboard navigation, accessible move menus, and evidence-gated review submission modal.
- Server-side RBAC hardening: supervisor read-only enforcement across status, checklist, and submission APIs.
- Comprehensive unit test coverage for status transitions, RBAC, evidence validation, and rollback recovery.
- Remaining: task definition editor, dependency editor/cycle-check API, checkpoint-level submission, and archival UI.

## WS-05 through WS-12

Status: not complete. Some tables are established to prevent incompatible schema decisions, but later workflows must not be represented as finished until their APIs, interfaces, authorization, and tests exist.
