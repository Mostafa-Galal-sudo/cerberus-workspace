# Implementation checkpoints

> **Status legend.** “Implemented” means the D1 schema, Worker API, authorization, and user interface exist and are exercised by automated tests. Partial modules are labeled explicitly. The original WS-05–WS-12 decomposition was referenced but never enumerated in this repository; module-based tracking is used below and the WS labels are retained only for continuity.

## WS-01 — Foundation and database

**Status: implemented and deployed to production.**

- React/Vite client and Cloudflare Worker are served as one deployment.
- D1 migrations define identity, projects, roadmaps, review workflows, communication, documentation, inventory, experiments, GitHub metadata, progress, and audit foundations (`0001`), forced password replacement (`0002`), workspace modules (`0003`), multi-evidence submissions plus checkpoint version uniqueness (`0004`), one-time password-reset tokens (`0005`), and realtime events, the email ledger, and R2 attachment metadata (`0006`).
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

## WS-06 — Documentation wiki

**Status: implemented.**

- Markdown pages with categories, visibility, immutable version history, search, and supervisor read-only enforcement.

## WS-07 — Defects and blockers

**Status: implemented.**

- Bug and blocker registration, severity, assignment, ownership-checked resolution, and resolution notes.

## WS-08 — Hardware inventory and experiments

**Status: implemented.**

- Hardware catalogue, quantity-aware checkout and return, assignment history, experiment definitions, owner-checked runs, input parameters, actual results, validation notes, and observed metrics.

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
- Production Worker `cerberus-workspace` is deployed at `https://cerberus-workspace.mosthistory139.workers.dev` with D1 database `cerberus-workspace` in WEUR. Migrations `0001`–`0006` are applied, initial data is intact (7 users, 30 tasks), the setup secret has been deleted, and the first administrator password was replaced at first login. The current Worker version is `0d155030-6148-4a8e-9b9a-c42aced8776f`.
- The production R2 bucket could not be created because R2 is not enabled for the account (`10042`) and the Wrangler OAuth token has no R2 management scope. The current production deployment was therefore published without the `ATTACHMENTS` binding; attachment routes return `503 ATTACHMENTS_UNAVAILABLE` until R2 is enabled, `cerberus-attachments` is created, and `npm run deploy` publishes the binding. Realtime events, server PDFs, authentication, and all D1-backed modules are active.
- Production smoke tests after deployment: health `200`, unauthenticated workspace routes `401`, closed setup endpoint `403`, cross-origin login `403`, invalid same-origin login `401`, and CSP/HSTS/nosniff/frame-denial headers present.
- CI run `39675830116` passed both jobs: typecheck, lint, 72 unit tests, 66 integration tests, production build, and the 6-test Playwright E2E suite.
- Playwright covers first-login password replacement, generic recovery requests, member route guards, administrative reassignment, attachment upload/download/archive, and server-rendered PDF downloads. The suite uses `reuseExistingServer: false`, resets isolated persistence, and runs the production build before testing.

## Verification

```powershell
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run build
npm run test:e2e
```

The integration suite runs the real Hono worker against an isolated D1 database through `@cloudflare/vitest-pool-workers`, applying every migration before each test file. It covers onboarding, authentication/CSRF/RBAC, password recovery, task and checkpoint review, multi-evidence persistence, task comments, realtime events, R2 attachments, submission-evidence access control, reassignment, server PDFs, chat/wiki/issues/hardware/experiments/decisions/worklogs/announcements, GitHub webhooks and outbound guards, administration, backup checksums, CSV exports, and assistant telemetry. Current totals: 72 unit tests, 67 integration tests across 12 files, and 6 Playwright end-to-end tests against an isolated local Worker, D1, and R2 state.
