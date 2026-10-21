# Implementation checkpoints

> **Status legend.** “Implemented” means the D1 schema, Worker API, authorization, and user interface exist and are exercised by automated tests. Partial modules are labeled explicitly. The original WS-05–WS-12 decomposition was referenced but never enumerated in this repository; module-based tracking is used below and the WS labels are retained only for continuity.

## WS-01 — Foundation and database

**Status: implemented and locally verifiable.**

- React/Vite client and Cloudflare Worker are served as one deployment.
- D1 migrations define identity, projects, roadmaps, review workflows, communication, documentation, inventory, experiments, GitHub metadata, progress, and audit foundations (`0001`), forced password replacement (`0002`), workspace modules (`0003`), multi-evidence submissions plus checkpoint version uniqueness (`0004`), and one-time password-reset tokens (`0005`).
- The initializer creates seven identities with unique temporary passwords, six member roadmaps, thirty checkpoints, thirty actionable seed tasks, required checklist items, and acyclic dependency chains.
- Temporary credentials are disclosed once and must remain in a gitignored private file; no password is stored in source control.

## WS-02 — Authentication and role access

**Status: implemented and integration-tested.**

- Forced first-login password replacement, one-time invitation activation and reissue, PBKDF2 password hashing, opaque server-side sessions, HttpOnly cookies, CSRF verification, login throttling, logout, role and permission checks, session revocation on suspension, and audit records.
- Administrative one-time password recovery: hashed 32-byte tokens with one-hour expiry, single-use enforcement, reissue retirement, per-address throttling, session-wide revocation after replacement, and a public `/reset-password` completion page. Links are delivered out of band; no email transport is implemented.
- Mostafa is one identity with member, technical lead, and super-admin roles; the interface switches modes without duplicating the account.
- Verified against real D1 in `tests/integration/auth-and-boundaries.test.ts`, `onboarding.test.ts`, `users-dashboard.test.ts`, and `password-reset.test.ts`.

## WS-03 — Members, teams, and roadmap

**Status: implemented for listing, profiles, suspension, invitation reissue, role assignment, and role editing.**

- All members, specializations, project membership, team membership, engineering domains, roadmaps, checkpoints, tasks, checklists, and dependency chains are persisted.
- Member listing, per-member roadmaps, profile editing, suspension/activation, invitation reissue, one-time password-reset issuance, and role assignment APIs exist.
- The Members page includes a role editor for the four workspace roles, a one-time reset-link action, and explicit copy controls for both activation and reset URLs.
- The last active super-admin is protected from removal, and administrators cannot suspend themselves.
- Team-reassignment UI remains incomplete.

## WS-04 — Tasks, checkpoints, and approval workflow

**Status: implemented end-to-end and integration-tested.**

- Paginated task listing/search/filter, detail records, required checklists, dependency enforcement, versioned evidence submissions, independent administrative review, self-approval prevention, notifications, audit events, and progress events.
- Interactive four-column drag-and-drop Kanban board with optimistic updates, rollback on failure, keyboard navigation, accessible move menus, and an evidence-gated review submission modal.
- Task specification editor, dependency graph with server-side cycle detection, archival, and checkpoint-level submission are implemented.
- Server-side checkpoint guards reject duplicate submissions (`ALREADY_SUBMITTED`) and checkpoints without mandatory tasks (`TASKS_INCOMPLETE`); checkpoint submissions are versioned atomically.
- Review queue renders task and checkpoint submissions with their full evidence set, links task submissions to their detail page, identifies checkpoint submissions, and prevents self-review in the interface as well as the API.
- Multi-evidence submissions are persisted correctly after `0004`, which removes the accidental one-evidence-per-submission constraint from `0001`.
- Task discussion comments are persisted with assignee/administrator posting rights, author-only editing, administrative moderation, soft deletion, and list rendering that excludes deleted rows.
- Verified by `task-workflow.test.ts`, `checkpoint-workflow.test.ts`, `task-comments.test.ts`, `auth-and-boundaries.test.ts`, and the unit suites for status transitions, RBAC, evidence validation, dependencies, and rollback recovery.

## WS-05 — Collaboration and notifications

**Status: implemented with polling.**

- Direct/team channels, channel-membership enforcement, message posting, author-only editing, author/admin deletion, read markers, announcements with audience filtering, and per-user notifications.
- The client polls; realtime transport (SSE/WebSocket) and file attachments are not implemented.

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

**Status: implemented for webhook ingestion and task linking.**

- Unauthenticated webhook receiver with constant-time HMAC-SHA256 verification against the configured secret, replay-safe delivery storage, push/PR task-reference linking, settings management, status inspection, and deterministic local event simulation.
- Outbound GitHub App installation tokens, PR creation, and repository synchronization are not implemented.

## WS-11 — Assistant and reports

**Status: implemented with an optional provider adapter and server-generated CSV exports.**

- The assistant answers from live task, wiki, blocker, decision, and member context and records usage telemetry.
- When `assistant.enabled` is true and `AI_API_KEY` is configured, the Worker calls an OpenAI-compatible `/chat/completions` endpoint using deployment-level `AI_BASE_URL`/`AI_MODEL` configuration. Responses are treated as untrusted text; tools are never invoked. Any disabled state, missing key, timeout, non-2xx response, or empty output falls back to the deterministic responder.
- CSV exports exist for tasks, roadmap progress, hardware inventory, and blockers. Task exports are scoped to the caller unless the caller is an administrator or supervisor; every export inserts a `report_exports` audit row; spreadsheet formula prefixes are neutralized.
- Server-generated PDF exports are not implemented; browser printing remains available.

## WS-12 — Administration, backup, and deployment

**Status: implemented locally; remote deployment not provisioned.**

- Administrative metrics, audit-log browser, workspace settings loaded from persisted state, checksummed full-database export, checksum-required backup integrity verification, and audit records for export/verification runs.
- Restore is verification-only; it does not overwrite live tables and does not report a restore that did not happen.
- `wrangler.jsonc` still contains `REPLACE_WITH_D1_DATABASE_ID`. No production D1 database or Worker deployment has been created.
- CI runs typecheck, lint, unit tests, D1-backed integration tests, and the production build.

## Verification

```powershell
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run build
```

The integration suite runs the real Hono worker against an isolated D1 database through `@cloudflare/vitest-pool-workers`, applying every migration before each test file. It covers onboarding, authentication/CSRF/RBAC, password recovery, task and checkpoint review, multi-evidence persistence, task comments, chat/wiki/issues/hardware/experiments/decisions/worklogs/announcements, GitHub webhooks, administration, backup checksums, CSV exports, and assistant telemetry. Current totals: 61 unit tests and 59 integration tests across 11 files.
