# Architecture — cerberus-workspace

## 1. Product, principals, protected resources

A private engineering-collaboration workspace for one graduation project (CERBERUS), delivered as a single Cloudflare Worker plus a React SPA. It is not multi-tenant: one team (`team_cerberus`), one project (`project_cerberus`), seven seeded identities.

Principals, lowest trust first: anonymous (health, static shell, setup-with-token, GitHub webhook, auth endpoints); `team_member` with `task.work` (own tasks, own worklogs, own submissions, own account, member-visible wiki, chat, own report rows); `project_supervisor` with `feedback.create` (read-only dashboards and team reports, plus written feedback); `technical_lead` (a role with **zero** `role_permissions` rows — it only qualifies as a work-transfer target); `workspace.admin` and `review.admin` (both currently only via `super_admin`); outbound peers (GitHub, email provider, OpenAI-compatible model provider); model output, treated as untrusted display text.

Protected resources: password and session material, TOTP secrets and recovery codes, invitation/reset tokens, other members' directory fields, submission evidence and attachments, wiki pages with restricted visibility, review decisions and approval state, audit and backup exports, and provider credentials.

## 2. Comparable baseline

No comparable application is present in the repository or its dependency tree. The design is a conventional RBAC + owner-scoped CRUD workspace with opaque server-side sessions, per-session CSRF, and DB-backed rate limiting. Two deliberate deviations from that baseline are visible in source and matter for calibration: (a) approval is a two-stage gate (task approval gates checkpoint submission), and (b) destructive/exfiltration-shaped operations are narrowed rather than broad — backup restore is verification-only, and reports/CSV are role-scoped. Where a defect is demonstrated, its severity is set by the demonstrated result only.

## 3. Stack, deployment paths, offline limits

TypeScript ESM, React 19 + Vite 7, Hono 4, Zod 4, TanStack Query, Cloudflare D1 (migrations `0001`–`0010`), optional R2, optional Resend/Cloudflare email, optional GitHub App/PAT, optional AI provider, daily cron.

Deployment paths selected deterministically in source: production (`package.json` `deploy` → `dist/cerberus_workspace/wrangler.json`), E2E (`scripts/start-e2e.mjs` → `wrangler.e2e.jsonc`, loopback 127.0.0.1:4173, isolated `.wrangler/e2e-state`), integration (`vitest.integration.config.ts` → `wrangler.test.jsonc`, in-memory Miniflare), local dev (`vite.config.ts` → `wrangler.jsonc`).

Offline build/test commands exist (`typecheck`, `lint`, `test`, `test:integration`) but this host has **no OS-enforced sandbox** (no Docker, no WSL, no network namespace, no read-only mount, no per-process file-size quota). Target-controlled execution is therefore not used for evidence in this run; every behavioral claim that needs execution is `needs_validation`.

## 4. Entry surfaces and source-to-sink paths

17 route mounts under `/api/v1` (`worker/index.ts:62-77`): setup, auth, account, dashboard, tasks, planning, reviews, reports, search, users, collaboration (SSE + polling, notifications), attachments, workspace (wiki, worklogs, decisions, issues, supervisor feedback, hardware, experiments), github, admin, assistant.

Highest-value source paths: credential verification (`auth.ts` → `security.ts` → `sessions`); MFA (`auth.ts` → `mfa.ts` → `mfa-secret.ts`); role and status mutation (`users.ts` → `user_roles` + `0007` triggers); approval (`tasks.ts` submission gate → `reviews.ts` decision); attachment ACL (`attachments.ts` `canView`/`canAttach` → R2); visibility filtering (`wiki-access.ts` consumed by wiki, search, attachments, assistant); exports (`reports.ts` → `csv.ts`/`pdf.ts`); webhook ingest (`github.ts` HMAC → `github_events` → task-ref regex); model boundary (`assistant.ts` fixed tool registry → `ai.ts` provider fetch).

## 5. Trust boundaries and strongest source-visible controls

| Boundary | Strongest control |
|---|---|
| Anonymous → session | PBKDF2-SHA256 100k, opaque token stored as SHA-256, idle expiry, revoked/status/archived checks (`middleware/auth.ts:14-31`) |
| Session → state-changing API | Per-session CSRF header, timing-safe compare, non-GET enforcement (`middleware/auth.ts:46-51`) |
| Any browser origin → API | Exact `APP_ORIGIN` match, production fails closed (`worker/index.ts:43-53`) |
| Member → someone else's work | Inline assignee/owner checks on every task, worklog, comment, submission, thread (`tasks.ts`, `reviews.ts`, `assistant.ts`) |
| Member → restricted content | `wiki-access.ts` filter reused by search/attachments/assistant; attachment `canView` for submission and wiki types |
| Reviewer → approval | Self-review forbidden, self-approval forbidden, `SUBMISSION_REQUIRED`, unique pending indexes (`reviews.ts:264-266,326`; `0007`) |
| Admin → last admin | Pre-check plus DB trigger (`users.ts:349-403`; `0007:23-43`) |
| External peer → webhook | HMAC-SHA256 over raw body, secret precedence, delivery idempotency, repository match |
| Model → system | Server-fixed tool names and prepared SQL; client never supplies tool arguments |

Controls that depend on deployment facts rather than source: `APP_ENV`/`APP_ORIGIN`, `SETUP_TOKEN` rotation, `MFA_ENCRYPTION_KEY`, R2 binding, email/GitHub/AI providers, `CF-Connecting-IP`, cron execution, and any Cloudflare Access layer (no reference in source).

## 6. Starting paths

`worker/index.ts`, `worker/middleware/auth.ts`, `worker/routes/*.ts`, `worker/services/*.ts`, `shared/schemas/*.ts`, `db/migrations/*.sql`, `src/app/*`, `src/lib/api.ts`, `src/components/markdown.tsx`, `wrangler*.jsonc`, `tests/unit/*`, `tests/integration/*`.

## 7. Prior coverage

No compatible prior ledger or `findings.json` exists for this repository. `docs/SECURITY_AUDIT_2026-10-22.md` is a free-form narrative report, not machine-readable prior state; it is background only and suppresses nothing. This run therefore starts with `prior_status: "none"` on every unit and makes no claim that earlier gaps are closed.

## 8. Companion selection

Selected because reconnaissance found the matching boundary: `DATA-ISOLATION-AND-LIFECYCLE.md` (RBAC-scoped rows, submission/wiki visibility, exports and backups), `AI-AND-LLM.md` (assistant tool registry and provider output), `CLIENT-SIDE.md` (markdown rendering, SPA route gates, CORS/cache leakage), `CLOUD-AND-DEPLOYMENT.md` (Worker vars, secrets, cron), `PROTOCOLS-RPC-AND-MESSAGING.md` (webhook replay/idempotency). Excluded: `MEMORY-SAFETY-AND-BINARY.md` (no native code, no parsers with manual memory management) and `DESKTOP-MOBILE-AND-LOCAL-IPC.md` (no desktop/mobile shell, no local IPC or deep links).
