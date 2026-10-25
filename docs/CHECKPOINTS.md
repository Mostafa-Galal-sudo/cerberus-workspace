# Implementation checkpoints

> **Status legend.** “Implemented” means the D1 schema, Worker API, authorization, and user interface exist and are exercised by automated tests. Partial modules are labeled explicitly. The original WS-05–WS-12 decomposition was referenced but never enumerated in this repository; module-based tracking is used below and the WS labels are retained only for continuity.

## WS-01 — Foundation and database

**Status: implemented and deployed to production.**

- React/Vite client and Cloudflare Worker are served as one deployment.
- D1 migrations define identity, projects, roadmaps, review workflows, communication, documentation, inventory, experiments, GitHub metadata, progress, and audit foundations (`0001`), forced password replacement (`0002`), workspace modules (`0003`), multi-evidence submissions plus checkpoint version uniqueness (`0004`), one-time password-reset tokens (`0005`), realtime events, the email ledger, and R2 attachment metadata (`0006`), and integrity guards for review races, duplicate pending submissions, and last-admin protection (`0007`).
- The initializer creates seven identities with unique temporary passwords, six member roadmaps, thirty checkpoints, thirty actionable seed tasks, required checklist items, and acyclic dependency chains.
- Temporary credentials are disclosed once and must remain in a gitignored private file; no password is stored in source control.

## WS-02 — Authentication and role access

**Status: implemented and integration-tested.**

- Forced first-login password replacement, one-time invitation activation and reissue, PBKDF2 password hashing, opaque server-side sessions, HttpOnly cookies, CSRF verification, login throttling, logout, role and permission checks, session revocation on suspension, and audit records.
- Password hashes use PBKDF2-SHA-256 with a per-password salt and 100,000 iterations, the maximum supported by Cloudflare Workers Web Crypto. The iteration count is embedded in each hash so the work factor can be raised later.
- One-time password recovery for both self-service requests and administrative issuance: hashed 32-byte tokens with one-hour expiry, single-use enforcement, reissue retirement, per-address throttling, session-wide revocation after replacement, and a public `/reset-password` completion page. A Resend or Cloudflare Email adapter delivers links when configured; otherwise the request returns a generic `202`, administrators receive an in-app notification, and the link is issued manually.
- Mostafa is one identity with member, technical lead, and super-admin roles; the interface switches modes without duplicating the account.
- Administrative and review routes are also guarded in the client; a signed-in member who requests them directly is redirected to the overview instead of seeing zeroed administrative panels.
- Verified against real D1 in `tests/integration/auth-and-boundaries.test.ts`, `onboarding.test.ts`, `users-dashboard.test.ts`, and `password-reset.test.ts`; route-guard redirects are covered in `tests/unit/route-guards.test.tsx`.

## WS-03 — Members, teams, and roadmap

**Status: implemented for listing, profiles, suspension, invitation reissue, role assignment, role editing, and work reassignment.**

- All members, specializations, project membership, team membership, engineering domains, roadmaps, checkpoints, tasks, checklists, and dependency chains are persisted.
- Member listing, per-member roadmaps, profile editing, suspension/activation, invitation reissue, one-time password-reset issuance, and role assignment APIs exist.
- The Members page includes a role editor for the four workspace roles, a one-time reset-link action with email-aware delivery messaging, and explicit copy controls for both activation and reset URLs.
- The last active super-admin is protected from removal, and administrators cannot suspend themselves.
- The Members page includes a bulk reassignment dialog for transferring selected tasks and checkpoint ownership between active contributors. Transfers are admin-only, require an active team member or technical lead as target, notify the recipient, emit a realtime event, preserve approval state, and create an audit record.

## WS-04 — Tasks, checkpoints, and approval workflow

**Status: implemented end-to-end and integration-tested.**

- Paginated task listing/search/filter, detail records, required checklists, dependency enforcement, versioned evidence submissions, independent administrative review, self-approval prevention, notifications, audit events, and progress events.
- Interactive four-column drag-and-drop Kanban board with optimistic updates, rollback on failure, keyboard navigation, accessible move menus, and an evidence-gated review submission modal.
- Task specification editor, dependency graph with server-side cycle detection, archival, and checkpoint-level submission are implemented.
- Server-side checkpoint guards reject duplicate submissions (`ALREADY_SUBMITTED`) and checkpoints without mandatory tasks (`TASKS_INCOMPLETE`); checkpoint submissions are versioned atomically.
- Review queue renders task and checkpoint submissions with their full evidence set, links task submissions to their detail page, identifies checkpoint submissions, and prevents self-review in the interface as well as the API.
- Multi-evidence submissions are persisted correctly after `0004`, which removes the accidental one-evidence-per-submission constraint from `0001`.
- Task discussion comments are persisted with assignee/administrator posting rights, author-only editing, administrative moderation, soft deletion, and list rendering that excludes deleted rows.
- Task assignment, review requests, review outcomes, attachments, and reassignment publish persisted per-user workspace events for realtime UI invalidation.
- Verified by `task-workflow.test.ts`, `checkpoint-workflow.test.ts`, `task-comments.test.ts`, `auth-and-boundaries.test.ts`, and the unit suites for status transitions, RBAC, evidence validation, dependencies, and rollback recovery.

## WS-05 — Collaboration and notifications

**Status: implemented with SSE plus polling fallback and R2 attachments.**

- Direct/team channels, channel-membership enforcement, message posting, author-only editing, author/admin deletion, read markers, announcements with audience filtering, and per-user notifications.
- `workspace_events` persists one row per recipient. The SSE endpoint streams events with `Last-Event-ID` replay, a bounded 25-second connection, and a 2-second internal poll; the client invalidates only the affected React Query families. A 30-second polling fallback covers reconnects and unsupported environments.
- Task evidence attachments use a private R2 binding, 10 MB limits, sanitized filenames, SHA-256 checksums stored in D1, resource-level upload authorization, audited downloads, and soft archival with an audit record. Submission evidence is restricted to the submitter and reviewers; `503 ATTACHMENTS_UNAVAILABLE` is returned when the binding is absent.
- The Notification Center adds unread counts with a sidebar badge, atomic read-all, type/read filtering with pagination meta, server-resolved deep links, and realtime invalidation written by the notification trigger.

## WS-06 — Documentation wiki

**Status: implemented.**

- Markdown pages with categories, visibility, immutable version history, search, and supervisor read-only enforcement.
- Pages render GitHub-flavored Markdown through `react-markdown` with raw HTML disabled and a strict URL allowlist; the editor offers a live preview and the selected page is reflected in the URL.

## WS-07 — Defects and blockers

**Status: implemented.**

- Bug and blocker registration, severity, assignment, ownership-checked resolution, and resolution notes.

## WS-08 — Hardware inventory and experiments

**Status: implemented.**

- Hardware catalogue, quantity-aware checkout and return, assignment history, experiment definitions, owner-checked runs, input parameters, actual results, validation notes, and observed metrics.
- Hardware items declare an explicit `quantity` or `serialized` tracking mode, record the return condition, keep a custody and maintenance ledger, and surface low stock and overdue maintenance.
- Experiment runs are numbered atomically, validated per metric, exportable as CSV, comparable in the UI, and optionally linked to a task or checkpoint.

## WS-09 — Decisions and worklogs

**Status: implemented.**

- Architecture decision records with status, reasoning, alternatives, impact, and supersession fields; shared worklogs with completed work, current work, problems, tests, evidence, and next steps.

## WS-10 — GitHub integration

**Status: implemented for webhook ingestion, task linking, and provider-gated outbound synchronization.**

- Unauthenticated webhook receiver with constant-time HMAC-SHA256 verification against the configured secret, replay-safe delivery storage, push/PR task-reference linking, settings management, status inspection, and deterministic local event simulation.
- Outbound actions accept either a personal access token (`GITHUB_TOKEN`) or a GitHub App installation (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID`). The App path signs a short-lived RS256 JWT, exchanges it for a cached installation token, and never exposes either credential to the browser.
- `/api/v1/github/sync` refreshes repository metadata and open pull requests and links referenced task IDs; `/api/v1/github/pull-request` creates a task-linked pull request. Repository names must use `owner/name`, branch names are validated, and both routes are admin-only, audited, and return `503 GITHUB_NOT_CONFIGURED` when credentials are absent.
- The Integrations page exposes outbound status, a manual sync action, and a pull-request dialog. Live provider calls remain unverified until credentials are configured.

## WS-11 — Assistant and reports

**Status: implemented with an optional provider adapter, server-generated CSV exports, and server-rendered PDF reports.**

- The assistant answers from live task, wiki, blocker, decision, and member context and records usage telemetry.
- When `assistant.enabled` is true and `AI_API_KEY` is configured, the Worker calls an OpenAI-compatible `/chat/completions` endpoint using deployment-level `AI_BASE_URL`/`AI_MODEL` configuration. Responses are treated as untrusted text; tools are never invoked. Any disabled state, missing key, timeout, non-2xx response, or empty output falls back to the deterministic responder.
- CSV exports exist for tasks, roadmap progress, hardware inventory, and blockers. Task exports are scoped to the caller unless the caller is an administrator or supervisor; every export inserts a `report_exports` audit row; spreadsheet formula prefixes are neutralized.
- PDF exports for roadmap progress, hardware inventory, and blockers are rendered server-side with `pdf-lib` using A4 pagination, repeated headers, ASCII-safe text, export timestamps, and `report_exports` audit rows. The Reports page exposes direct download links; browser printing remains available.

## WS-12 — Administration, backup, and deployment

**Status: implemented and deployed to Cloudflare.**

- Administrative metrics, audit-log browser, workspace settings loaded from persisted state, checksummed full-database export, checksum-required backup integrity verification, and audit records for export/verification runs.
- Static asset responses carry a `_headers` policy with CSP, HSTS, `nosniff`, frame denial, no-referrer, and a restrictive permissions policy; the Worker applies matching security headers to API responses. Scripts remain self-only while inline styles remain permitted for the React UI.
- Restore is verification-only; it does not overwrite live tables and does not report a restore that did not happen.
- Production Worker `cerberus-workspace` is deployed at `https://cerberus-workspace.mosthistory139.workers.dev` with D1 database `cerberus-workspace` in WEUR. Migrations `0001`–`0007` are applied, initial data is intact (7 users, 30 tasks), the setup secret has been deleted, and the first administrator password was replaced at first login. The current Worker version is `a775154e-6d0a-4a98-b571-a0035aefa3a0`.
- The production R2 bucket could not be created because R2 is not enabled for the account (`10042`) and the Wrangler OAuth token has no R2 management scope. The current production deployment was therefore published without the `ATTACHMENTS` binding; attachment routes return `503 ATTACHMENTS_UNAVAILABLE` until R2 is enabled, `cerberus-attachments` is created, and `npm run deploy` publishes the binding. Realtime events, server PDFs, authentication, and all D1-backed modules are active.
- Production smoke tests after deployment: health `200`, unauthenticated workspace routes `401`, closed setup endpoint `403`, cross-origin login `403`, invalid same-origin login `401`, and CSP/HSTS/nosniff/frame-denial headers present.
- CI run `39707287338` passed both jobs for the remediation commit `cd53399`: verify (typecheck, lint, 72 unit tests, 76 integration tests, production build) and E2E (6 Playwright tests). The prior CI run `39677694573` covered the pre-remediation state. Remediation evidence is recorded in `docs/SECURITY_AUDIT_2026-10-22.md`.
- Playwright covers first-login password replacement, generic recovery requests, member route guards, administrative reassignment, attachment upload/download/archive, and server-rendered PDF downloads. The suite uses `reuseExistingServer: false`, resets isolated persistence, and runs the production build before testing.

## Phase 1 — documentation safety, run explorer, hardware lifecycle, notifications, search

**Status: implemented and verified locally; not deployed.**

- Migration `0008_phase1_workspace.sql` adds hardware `tracking_mode`/`minimum_quantity`, return-condition metadata, the hardware maintenance log, experiment run task/checkpoint links, and the `notifications_workspace_event` trigger that writes `workspace_events` rows. It is applied to local D1 only; remote D1 remains at `0001`–`0007`.
- Wiki pages and assistant replies render GitHub-flavored Markdown through `react-markdown` + `remark-gfm` with raw HTML disabled and a strict URL allowlist (`http`, `https`, `mailto`, relative). The wiki page keeps the selected slug in the URL and provides a live editor preview.
- Experiment runs have list/create/detail plus CSV export, per-metric validation, atomic `run_number` allocation backed by a unique index, and UI history, comparison, trend chart, and optional task/checkpoint links.
- Hardware supports explicit `quantity` and `serialized` tracking modes, admin-only checkout and maintenance, holder-or-admin return with a required condition, custody history, maintenance/calibration log, low-stock state, and overdue maintenance.
- The Notification Center exposes paginated filtering, an atomic read-all, a sidebar unread badge, server-resolved deep links, and realtime invalidation from the notification trigger. Polling remains the fallback.
- Global search covers tasks, wiki pages, and decisions with server-side ACL filtering, and the Ctrl/Cmd+K palette adds recent items, quick actions, and keyboard navigation.
- New coverage: `tests/unit/markdown.test.tsx`, `tests/unit/palette.test.ts`, schema assertions in `tests/unit/schemas.test.ts`, `tests/integration/phase1-workspace.test.ts`, and two E2E cases for wiki rendering/preview and the command palette.

## Phase 2 — planning, review governance, notification delivery, GitHub PR state

**Status: implemented and verified locally; not deployed.**

- Migration `0009_phase2_planning_governance.sql` adds task `start_date`/`due_date`/`estimate_hours`, `task_worklogs`, `review_rubrics`, `review_rubric_criteria`, submission reviewer/rubric/score columns, `notification_settings`, `notification_digests`, `github_pull_requests`, and `github_pull_request_tasks`. It is applied to local D1 only; remote D1 remains at `0001`–`0007`.
- Scheduling: task create and update validate `start_date <= due_date` and an estimate between 0 and 10,000 hours (`INVALID_SCHEDULE` on conflict). Task list and detail responses expose the schedule plus logged hours. Worklogs are restricted to the assignee or an administrator, accept quarter-hour granularity between 0.25 and 24 hours, reject dates beyond today+1 UTC (`FUTURE_WORKLOG`), enforce a 24-hour per-user per-day cap across tasks (`DAILY_HOURS_EXCEEDED`), and audit add/remove. The task detail page renders a schedule summary and an effort ledger.
- Planning API: `/api/v1/planning/my-week`, `/calendar`, `/timeline`, and `/workload` cover My Week, overdue work, the calendar month grid, the dependency Gantt, and per-member capacity. Members only read their own plan; administrators, technical leads, and supervisors may request `memberId`; supervisors are explicitly read-only. Windows are capped at 180 days, list responses carry pagination meta, and dependency edges travel in `meta.edges`.
- Review governance: rubrics hold 2–12 weighted criteria with unique labels summing to 100 and can be deactivated. Assignment stores reviewer and optional rubric on the submission, notifies the reviewer, forbids self-review (`SELF_REVIEW_FORBIDDEN`), and restricts the decision to the assigned reviewer with a super-admin override. Scored decisions persist `scores_json` and `total_score`; rubric mismatch (`RUBRIC_MISMATCH`), missing scores (`RUBRIC_SCORES_REQUIRED`), and scores without a rubric (`RUBRIC_REQUIRED`) are rejected. Unscored decisions remain valid when no rubric is assigned.
- Notification delivery: category-level preferences (`task`, `review`, `collaboration`, `account`, `digest`) with separate in-app and email channels are applied as read-time SQL filters, so existing insert sites are unchanged. Digest frequency is persisted per user; period digests are created idempotently, exposed through a manual endpoint, and generated by the scheduled cron. Email remains provider-gated: with no transport configured, digests are recorded as `skipped` and no live delivery is claimed.
- GitHub PR/CI state: webhook deliveries persist open/closed/merged pull requests with draft flag, head/base refs, head SHA, and merge timestamp; `check_suite`, `check_run`, and `status` events roll up into `checks_status`. `/api/v1/github/pull-requests` is paginated and filterable by state, and repository sync additionally fetches check rollups for up to 10 open pull requests. A merge only notifies linked assignees (`task.github_merged`) that the task is ready for evidence submission; it never moves the task to `ready_for_review` or bypasses the evidence gate.
- UI: one `/planning` page with WAI-ARIA tabs (roving tabindex, arrow/Home/End navigation), schedule fields and the worklog ledger on task detail, reviewer assignment plus weighted scoring in the review queue, delivery preferences and digest controls in the notification center, and a pull-request/CI panel on the integrations page.
- New coverage: `tests/unit/phase2-planning.test.ts` (date helpers, planning schemas, scored decisions, check rollups), `tests/integration/phase2-planning.test.ts` (scheduling, worklog caps, planning ACLs, rubric and assignment governance, notification filtering and digests, webhook PR/check persistence), and `tests/e2e/planning.spec.ts` (keyboard-navigable tabs and worklog-to-ledger flow).

## Verification

```powershell
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run build
npm run test:e2e
```

The integration suite runs the real Hono worker against an isolated D1 database through `@cloudflare/vitest-pool-workers`, applying every migration before each test file. It covers onboarding, authentication/CSRF/RBAC, password recovery, task and checkpoint review, multi-evidence persistence, task comments, realtime events, R2 attachments, submission-evidence access control, reassignment, server PDFs, chat/wiki/issues/hardware/experiments/decisions/worklogs/announcements, GitHub webhooks and outbound guards, administration, backup checksums, CSV exports, assistant telemetry, the Phase 1 search/notification/run/hardware slices, and the Phase 2 scheduling, planning, review-governance, notification-delivery, and pull-request/CI slices. Current totals: 99 unit tests across 16 files, 92 integration tests across 14 files, and 10 Playwright end-to-end tests against an isolated local Worker, D1, and R2 state. Phases 1 and 2 remain local-only: migrations `0008` and `0009` are not applied remotely and production still runs Worker `a775154e-6d0a-4a98-b571-a0035aefa3a0`. The remediation evidence and residual risks are recorded in `docs/SECURITY_AUDIT_2026-10-22.md`.
