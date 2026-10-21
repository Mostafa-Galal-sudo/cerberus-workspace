# CERBERUS WORKSPACE

Private engineering collaboration software for the CERBERUS graduation project. The repository implements the secure foundation and the full task, checkpoint, review, collaboration, documentation, inventory, experiment, integration, administration, and assistant modules on Cloudflare Workers + D1 + React. See [checkpoint status](docs/CHECKPOINTS.md) for precise scope and remaining work.

## Implemented now

- Cloudflare Workers + Static Assets deployment with a Hono API and React client.
- D1 schema and migrations for identity, projects, roadmaps, review workflows, communication, documentation, inventory, experiments, GitHub metadata, progress, audit, and workspace modules.
- Seven identities with unique random temporary passwords disclosed once during initialization, plus invitation reissue and one-time activation.
- Mandatory first-login password replacement, PBKDF2-SHA256 hashes, opaque server-side sessions, HttpOnly cookies, CSRF protection, login throttling, logout, account suspension with session revocation, last-admin protection, role assignment, and audit logs.
- Six persisted engineering roadmaps: 30 milestones, 30 checkpoints, detailed seed tasks, checklists, and acyclic dependency chains.
- Task search, detail, specification editor, checklist enforcement, dependency graph with server-side cycle detection, versioned evidence submission, multi-row evidence storage, review queue, approval/change request, archival, notifications, and progress events.
- Checkpoint-level submission with mandatory-task gating, duplicate-submission guards, atomic versioning, review, changes-requested resubmission, and approval timestamps.
- Interactive four-column drag-and-drop Kanban board with optimistic updates, rollback on failure, keyboard navigation, and accessible move menus.
- Role-specific persisted dashboards, member roadmaps, and supervisor-safe progress reads.
- Direct/team chat with membership enforcement and author-only editing, announcements with audience scoping, per-user notifications, and read markers.
- Markdown wiki with immutable version history and supervisor read-only enforcement.
- Bug and blocker tracking with ownership-checked resolution.
- Hardware inventory with quantity-aware checkout/return and experiment definitions with owner-checked runs and metrics.
- Architecture decisions and shared worklogs.
- GitHub webhook ingestion with constant-time HMAC-SHA256 verification, task-reference linking, settings, status, and local event simulation.
- Administrative metrics, audit-log browser, workspace settings, checksummed backup export, and backup integrity verification.
- Deterministic workspace assistant grounded in live task/wiki/blocker/decision/member context with usage telemetry.

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
```

`npm test` runs the jsdom unit/component suite. `npm run test:integration` runs the real Worker and Hono routes against an isolated D1 database using `@cloudflare/vitest-pool-workers`, applying every migration and exercising authentication, RBAC, task/checkpoint review, multi-evidence persistence, workspace modules, GitHub webhooks, administration, backup checksums, and assistant telemetry.

## Cloudflare deployment preparation

Remote deployment has **not** been provisioned. `wrangler.jsonc` still contains `REPLACE_WITH_D1_DATABASE_ID`. To deploy:

1. Authenticate Wrangler: `npx wrangler login`
2. Create D1: `npx wrangler d1 create cerberus-workspace`
3. Replace `REPLACE_WITH_D1_DATABASE_ID` in `wrangler.jsonc` with the returned ID.
4. Set bootstrap secret: `npx wrangler secret put SETUP_TOKEN`
5. Apply migrations: `npm run db:migrate:remote`
6. Deploy: `npm run deploy`
7. Call `/api/v1/setup/initialize` once using the setup secret, save the one-time temporary credentials, then rotate or delete the setup secret.

Production must set `APP_ENV` to `production` and `APP_ORIGIN` to the exact deployed HTTPS origin. External integrations are disabled until their credentials are configured. Never commit `.dev.vars` or provider credentials; the build script rejects bundles that contain values from `.dev.vars`.

## Security notes

- Passwords use Web Crypto PBKDF2-SHA-256 with per-password salts and 310,000 iterations.
- Temporary passwords are unique per account; authenticated users with `must_change_password` set cannot access workspace APIs until replacement.
- Session tokens are random and only SHA-256 hashes are stored; the cookie is HttpOnly, SameSite Strict, and Secure in production.
- State-changing authenticated requests require the per-session CSRF value.
- Authorization is enforced in the Worker. Client-side navigation is not a security boundary.
- A submitter cannot administratively review their own submission, including Mostafa in member mode.
- GitHub webhooks are verified with constant-time HMAC-SHA256 comparison; unsigned or malformed deliveries are rejected when a secret is configured.
- Uploaded binaries are not stored in D1 and R2 is not used.

## Known limitations

- Self-service password recovery by email is not implemented; administrators can reissue one-time activation links.
- Realtime transport (SSE/WebSocket), file attachments, administrative role-editing UI, and team-reassignment UI are not implemented.
- The assistant is deterministic and does not call an external LLM; `AI_API_KEY` is reserved for a future provider adapter.
- Report export is browser printing; server-generated PDF/CSV exports and the `report_exports` table are not implemented.
- Backup restore is verification-only and does not overwrite live tables.
- Outbound GitHub App tokens, PR creation, and repository synchronization are not implemented.
- Remote D1/Worker deployment and end-to-end browser tests remain.
