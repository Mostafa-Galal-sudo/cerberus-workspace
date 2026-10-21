# CERBERUS WORKSPACE

Private engineering collaboration software for the CERBERUS graduation project. The repository implements the secure foundation and the full task, checkpoint, review, collaboration, documentation, inventory, experiment, integration, administration, and assistant modules on Cloudflare Workers + D1 + React. See [checkpoint status](docs/CHECKPOINTS.md) for precise scope and remaining work.

## Implemented now

- Cloudflare Workers + Static Assets deployment with a Hono API and React client.
- D1 schema and migrations for identity, projects, roadmaps, review workflows, communication, documentation, inventory, experiments, GitHub metadata, progress, audit, and workspace modules.
- Seven identities with unique random temporary passwords disclosed once during initialization, plus invitation reissue and one-time activation.
- Mandatory first-login password replacement, PBKDF2-SHA256 hashes, opaque server-side sessions, HttpOnly cookies, CSRF protection, login throttling, logout, account suspension with session revocation, last-admin protection, role assignment, administrative role-editing UI, and audit logs.
- One-time password-recovery links for both self-service requests and administrative issuance: 32-byte tokens stored only as SHA-256 digests, one-hour expiry, single use, token retirement, and revocation of every previous session after replacement. A Resend or Cloudflare Email adapter delivers links when configured; otherwise administrators receive an in-app notification and issue the link manually.
- Six persisted engineering roadmaps: 30 milestones, 30 checkpoints, detailed seed tasks, checklists, and acyclic dependency chains.
- Task search, detail, specification editor, checklist enforcement, dependency graph with server-side cycle detection, versioned evidence submission, multi-row evidence storage, review queue, approval/change request, archival, notifications, and progress events.
- Task discussion comments with assignee/administrator posting rights, author-only editing, administrative moderation, soft deletion, and audit records for deletions.
- Checkpoint-level submission with mandatory-task gating, duplicate-submission guards, atomic versioning, review, changes-requested resubmission, and approval timestamps.
- Interactive four-column drag-and-drop Kanban board with optimistic updates, rollback on failure, keyboard navigation, and accessible move menus.
- Role-specific persisted dashboards, member roadmaps, and supervisor-safe progress reads.
- Direct/team chat with membership enforcement and author-only editing, announcements with audience scoping, per-user notifications, and read markers.
- Server-sent-event workspace delivery with a persisted per-user cursor, Last-Event-ID replay, targeted React Query invalidation, and a 30-second polling fallback.
- Private task evidence attachments stored as R2 objects with SHA-256 checksums, 10 MB limits, resource-level upload authorization, audited downloads, and soft archival.
- Markdown wiki with immutable version history and supervisor read-only enforcement.
- Bug and blocker tracking with ownership-checked resolution.
- Hardware inventory with quantity-aware checkout/return and experiment definitions with owner-checked runs and metrics.
- Architecture decisions and shared worklogs.
- GitHub webhook ingestion with constant-time HMAC-SHA256 verification, task-reference linking, settings, status, and local event simulation.
- Outbound GitHub integration with personal-access-token or GitHub App installation authentication, repository synchronization, task-linked pull-request creation, persisted sync status, and audit records. Outbound actions remain provider-gated until credentials exist.
- Administrative metrics, audit-log browser, workspace settings loaded from persisted state, checksummed backup export, and checksum-required backup integrity verification.
- Server-generated CSV exports for tasks, roadmap progress, hardware inventory, and blockers, with role-scoped task rows, spreadsheet formula-injection neutralization, and `report_exports` audit records.
- Server-rendered A4 PDF reports for roadmap progress, hardware inventory, and blockers using `pdf-lib`, with pagination, ASCII-safe text, export audit rows, and download links in the Reports page.
- Workspace assistant grounded in live task/wiki/blocker/decision/member context with usage telemetry. An optional OpenAI-compatible provider adapter is gated by the persisted `assistant.enabled` setting and an `AI_API_KEY`; any provider failure falls back to the deterministic response.
- Playwright end-to-end coverage for first-login password replacement, recovery requests, member route guards, administrative work reassignment, attachment upload/download/archive, and server-rendered PDF downloads against a production build and isolated local D1/R2 state.

## Requirements

- Node.js 22+
- npm 10+
- A Cloudflare account only for remote deployment; local D1 development does not require credentials.

## Local setup

```powershell
npm install
Copy-Item .dev.vars.example .dev.vars
# Edit .dev.vars and give SETUP_TOKEN a long random value.
npm run db:migrate:local
npm run dev
```

Initialize the empty local database once from a second terminal:

```powershell
$headers = @{ Authorization = "Bearer <the SETUP_TOKEN from .dev.vars>" }
Invoke-RestMethod -Method Post -Uri http://localhost:5173/api/v1/setup/initialize -Headers $headers
```

The response contains seven unique temporary credentials. Store them in a private, gitignored location and send each password only to its intended person. Every workspace API is blocked until that person replaces the temporary password on first login. Seed email addresses use the reserved `.local` domain and should be updated through the admin identity workflow before production use.

## Verification

```powershell
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run build
npm run test:e2e
```

`npm test` runs the jsdom unit/component suite (72 tests). `npm run test:integration` runs the real Worker and Hono routes against an isolated D1 database using `@cloudflare/vitest-pool-workers` (66 tests across 12 files), applying every migration and exercising authentication, RBAC, password recovery, task/checkpoint review, multi-evidence persistence, task comments, realtime event publication, R2 attachments, reassignment, server PDFs, workspace modules, GitHub webhooks and outbound guards, administration, backup checksums, CSV exports, and assistant telemetry. `npm run test:e2e` builds the production bundle, applies migrations to an isolated local D1/R2 state, and runs the Playwright suite (6 browser tests). Install the bundled browser with `npx playwright install chromium`; on Windows, an existing Edge installation can be used with `$env:E2E_BROWSER_CHANNEL='msedge'`.

## Cloudflare deployment

Production is deployed at `https://cerberus-workspace.mosthistory139.workers.dev` using Worker `cerberus-workspace`, D1 database `cerberus-workspace` (region WEUR), and the database ID committed in `wrangler.jsonc`. The database ID is not a secret. To provision a fresh environment:

1. Authenticate Wrangler: `npx wrangler login` in an interactive terminal, or provide `CLOUDFLARE_API_TOKEN` with D1, R2, and Workers permissions in non-interactive environments. Verify with `npx wrangler whoami`.
2. Create D1: `npx wrangler d1 create cerberus-workspace`
3. Replace the `database_id` in `wrangler.jsonc` with the returned ID and set `APP_ORIGIN` to the exact HTTPS origin that will serve the Worker.
4. Enable R2 in the Cloudflare dashboard, then create the private evidence bucket: `npx wrangler r2 bucket create cerberus-attachments`
5. Apply migrations: `npm run db:migrate:remote` (includes `0006` for realtime events, the email ledger, and R2-backed attachments)
6. Deploy: `npm run deploy`
7. Set the bootstrap secret now that the Worker exists: `npx wrangler secret put SETUP_TOKEN`
8. Optionally configure live integrations: `EMAIL_PROVIDER`, `EMAIL_API_KEY`, and `EMAIL_FROM` for Resend or the Cloudflare Email binding; `GITHUB_TOKEN` for PAT authentication; or `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, and `GITHUB_APP_INSTALLATION_ID` for GitHub App authentication.
9. Call `/api/v1/setup/initialize` once using the setup secret, save the one-time temporary credentials, then delete the setup secret.

Current production state (2026-10-22): migrations `0001`–`0006` are applied and Worker version `0d155030-6148-4a8e-9b9a-c42aced8776f` is live. R2 is not yet enabled on the account, so that deployment was published without the `ATTACHMENTS` binding and attachment routes return `503 ATTACHMENTS_UNAVAILABLE`. After enabling R2 and creating `cerberus-attachments`, run `npm run deploy` to publish the binding.

`APP_ENV` is `production` and `APP_ORIGIN` must always match the exact deployed HTTPS origin, including when a custom domain is added. External integrations are disabled until their credentials are configured. Never commit `.dev.vars` or provider credentials; the build script rejects bundles that contain values from `.dev.vars`.

## Security notes

- Passwords use Web Crypto PBKDF2-SHA-256 with per-password salts and 100,000 iterations, the maximum supported by Cloudflare Workers Web Crypto. This is below the current OWASP PBKDF2-SHA-256 recommendation; it is a platform constraint. Rate limiting reduces online guessing, and the iteration count is stored in each hash so the work factor can be raised later without invalidating existing passwords.
- Temporary passwords are unique per account; authenticated users with `must_change_password` set cannot access workspace APIs until replacement.
- Session tokens are random and only SHA-256 hashes are stored; the cookie is HttpOnly, SameSite Strict, and Secure in production.
- Password-reset tokens are random, stored only as SHA-256 digests, valid for one hour, single-use, retired when reissued, and enforced with per-address throttling. Successful replacement revokes every existing session for the account.
- State-changing authenticated requests require the per-session CSRF value.
- Authorization is enforced in the Worker. Client-side navigation is not a security boundary.
- A submitter cannot administratively review their own submission, including Mostafa in member mode.
- GitHub webhooks are verified with constant-time HMAC-SHA256 comparison; unsigned or malformed deliveries are rejected when a secret is configured.
- Uploaded evidence binaries are stored as private R2 objects, limited to 10 MB, and referenced from D1 only by metadata, object key, and SHA-256 checksum. Downloads require an authenticated workspace session, set `nosniff` and sandbox headers, and are recorded in the audit log. Legacy external attachment links remain redirect-only.
- Static assets ship a `_headers` policy with CSP, HSTS, `nosniff`, frame denial, no-referrer, and a restrictive permissions policy. Inline styles remain allowed because the React UI uses style attributes; scripts remain self-only.

## Known limitations

- Self-service password recovery sends email only when `EMAIL_PROVIDER` and its credentials are configured. Without a provider, the request still succeeds generically and administrators receive an in-app notification so they can issue a one-time link manually.
- Realtime events use SSE with a 30-second polling fallback. The SSE stream is bounded to 25 seconds per connection and reconnects with the persisted cursor; it is not a WebSocket transport.
- Attachment uploads require the `ATTACHMENTS` R2 binding and an existing private bucket. If the binding is absent or the bucket is unavailable, the API returns `503 ATTACHMENTS_UNAVAILABLE` rather than silently storing binaries in D1.
- Outbound GitHub synchronization and pull-request creation require `GITHUB_TOKEN` or complete GitHub App credentials. Without them, the endpoints return `503 GITHUB_NOT_CONFIGURED`; webhook ingestion remains independent.
- The assistant calls an external OpenAI-compatible provider only when `assistant.enabled` is true and `AI_API_KEY` is configured; otherwise it uses the deterministic workspace-grounded responder. Provider responses are untrusted text and never execute tools.
- Report exports are CSV, server-rendered PDF, and browser print. Backup restore is verification-only and does not overwrite live tables.
- Playwright E2E requires a local Chromium download (`npx playwright install chromium`) or an installed Edge/Chrome channel.
