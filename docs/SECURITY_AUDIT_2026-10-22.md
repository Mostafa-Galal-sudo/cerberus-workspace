# CERBERUS Workspace — Security Audit and Remediation

**Date:** 2026-10-22  
**Scope:** Cloudflare Worker API, D1 schema and migrations, React client, local isolated dynamic testing, and non-intrusive production checks.  
**Production origin:** `https://cerberus-workspace.mosthistory139.workers.dev`  
**Production Worker version:** `a775154e-6d0a-4a98-b571-a0035aefa3a0`  
**D1 database:** `cerberus-workspace` (`6aac7050-c5a2-49c8-90f2-840920ea58bf`, WEUR)

## Method

- Inspected route registration, authentication/authorization middleware, SQL statements, schemas, file handling, outbound integrations, and client-side URL rendering.
- Ran the dynamic audit against an isolated local Worker on `127.0.0.1:4173` with a separate `.wrangler/audit-state` D1/R2 state and test-only accounts. The audit performed 69 checks covering authentication boundaries, CSRF/CORS, wiki and attachment ACLs, attachment IDOR, webhook writes, task resubmission, rate limits, report/assistant scoping, supervisor writes, directory privacy, GitHub signature and task-link validation, and URL schemes.
- Ran the repository gates: TypeScript, ESLint, unit tests, D1-backed integration tests, production build, and Playwright E2E.
- Performed only non-intrusive production checks: health, unauthenticated responses, setup closure, cross-origin denial, security headers, CORS preflight, webhook fail-closed behavior, and D1 aggregate counts. No authenticated production mutation was attempted.

## Findings and remediation

| ID | Severity | Finding | Impact | Remediation | Verification |
|---|---|---|---|---|---|
| F-01 | High | Wiki page visibility was not consistently enforced across list, detail, version history, and attachment access. | Members or supervisors could reach pages intended for a different audience. | Added shared `canViewWiki`, `canEditWiki`, `canCreateWiki`, and SQL visibility filtering. Applied the checks to wiki reads, version writes, and wiki attachment listing/download. | Integration tests for admin-only wiki pages and attachment denial; dynamic audit checks. |
| F-02 | High | Attachment resources were not fully parent-authorized; submission evidence could be listed or downloaded by users other than the submitter and reviewers. | Evidence IDOR and disclosure of private submission attachments. | Added read ACLs for submission and wiki attachments: submission evidence is limited to the submitter and `review.admin`/`workspace.admin` users, and wiki attachments follow page visibility. Added upload/delete authorization for task, checkpoint, submission, bug, blocker, experiment, and wiki records; task/checkpoint/bug/blocker/experiment attachments remain readable by the authenticated team, matching those modules' team-wide visibility. Added safe redirect handling and upload limits. | `completion-modules.test.ts` verifies member, supervisor, owner, and reviewer access; dynamic audit attachment IDOR checks. |
| F-03 | High | Supervisor accounts could perform write actions outside their read-and-feedback role. | Unauthorized task, wiki, chat, worklog, hardware, experiment, bug, and attachment mutations. | Enforced supervisor read-only behavior on write routes and attachment deletion; supervisors retain feedback creation and read access. Administrator overrides remain available. | Integration tests for supervisor writes; dynamic audit supervisor checks. |
| F-04 | High | Task update and status endpoints accepted fields/transitions that allowed assignees to bypass the review workflow. | Assignees could move work into `ready_for_review`/`approved` or edit protected specification fields. | Added explicit `updateTaskSchema`; restricted assignee transitions to safe states; blocked changes from `ready_for_review` and `approved`; retained administrator overrides. Submissions are allowed only from `backlog`, `in_progress`, and `changes_requested`. | Task workflow integration tests, including negative transition and resubmission cases. |
| F-05 | High | The last active administrator could lose the admin role. | Workspace lockout and loss of administrative control. | Route-level last-admin guard plus D1 triggers `prevent_last_admin_role_removal` and `prevent_last_admin_deactivation` in migration `0007`. | Remote D1 has 2 triggers and 1 active admin; dynamic audit checks role removal/deactivation. |
| F-06 | Medium | Authentication responses allowed timing differences for unknown users, and rate limiting was not fully atomic. | User enumeration and concurrent brute-force bypass. | Added dummy PBKDF2 verification for unknown users, atomic `login_attempts` consumption, per-account and per-IP limits, constant-time CSRF comparison, production-only `__Host-` cookie acceptance, and session revocation on password reset. | Auth boundary integration tests; dynamic audit rate-limit checks. |
| F-07 | Medium | CORS could fall back to the request origin when `APP_ORIGIN` was absent. | Cross-origin requests could be accepted in a misconfigured deployment. | Production now returns `503 ORIGIN_NOT_CONFIGURED` when `APP_ORIGIN` is absent; allowed origin is exact; API responses are `Cache-Control: no-store`. | Production smoke: exact-origin preflight accepted, cross-origin login denied, API no-store present. |
| F-08 | High | GitHub webhook and outbound handling accepted unsafe configuration, task references, and URL values. | Spoofed webhook events, unsafe repository/branch input, invalid task links, and misleading settings state. | Webhook now fails closed unless enabled and a secret exists; verifies HMAC-SHA256; caps body size; rate limits deliveries; matches repository; validates task references; ignores archived/nonexistent tasks; validates repository/branch; uses safe `http(s)` URLs; treats duplicate delivery IDs idempotently. | `github-admin.test.ts` covers signature rejection, disabled/no-secret fail-closed behavior, duplicate delivery, task-existence checks, and simulation. |
| F-09 | Medium | The member directory exposed email, bio, and last-activity details to ordinary members. | Unnecessary personal/activity disclosure. | Directory and detail responses mask email, bio, and last-activity fields for ordinary members; owners and privileged roles retain full fields. | `users-dashboard.test.ts` and dynamic audit privacy checks. |
| F-10 | Medium | Assistant usage telemetry and wiki context were available too broadly, and prompts lacked bounded usage. | Usage-data disclosure, wiki visibility bypass through AI context, and provider-cost abuse. | Restricted usage telemetry to administrators/supervisors; filtered wiki context by visibility; capped prompt and reply sizes; added per-user rate limiting. | Assistant integration tests and dynamic audit scoping checks. |
| F-11 | Medium | Team-wide CSV/PDF reports were available to ordinary members. | Disclosure of team operational data. | Team reports require `super_admin` or `project_supervisor`; task CSV remains role-scoped; exports are audited. | Report integration tests; dynamic audit report scoping. |
| F-12 | High | `sanitize-html` version was behind a security fix. | Potential HTML-sanitization bypass in rendered content. | Upgraded `sanitize-html` to `2.18.1`. | `npm audit --omit=dev` reports 0 vulnerabilities. |
| F-13 | Low | Duplicate GitHub deliveries caused a unique-constraint failure instead of an idempotent acknowledgement. | Repeated GitHub delivery attempts could produce `500` responses and retry loops. | Duplicate check plus unique-constraint fallback returns `200` with `duplicate: true`; regression test added. | `github-admin.test.ts` duplicate-delivery test. |
| F-14 | Low | Rate-limit, event, assistant-usage, and email ledgers grew without pruning. | Unbounded D1 growth. | Added scheduled cleanup for sessions, reset tokens, invitations, login attempts, workspace events, GitHub events, assistant usage, and email outbox. | Build/typecheck; cron trigger deployed as `17 3 * * *`. |
| F-15 | Medium | Ad hoc request parsing allowed missing field constraints and unsafe URL schemes. | Oversized or malformed values, unsafe evidence/attachment URLs, and inconsistent validation. | Added explicit Zod schemas for task updates and wiki versions; centralized `http(s)` URL validation; applied safe URL handling to attachments, GitHub data, hardware datasheets, and client rendering. | Typecheck, lint, integration tests, dynamic URL-scheme checks. |

## Evidence summary

### Local verification

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run test`: 72 tests passed across 13 files.
- `npm run test:integration`: 76 tests passed across 12 files, with migrations `0001`–`0007` applied to isolated D1.
- `npm run test:e2e`: 6 Playwright tests passed using the Edge channel.
- Production build succeeded; build sanitization removed `.dev.vars` from `dist`.
- `npm audit --omit=dev`: 0 vulnerabilities.
- Full `npm audit`: 12 dev-tooling findings (2 moderate, 10 high), primarily in test/build tooling; no production dependency findings.

### Dynamic audit

The isolated dynamic audit completed 69/69 checks. It exercised:

- authentication, CSRF, and CORS boundaries;
- wiki visibility and edit ACLs;
- attachment listing, download, and IDOR controls;
- webhook writes without a valid secret;
- task resubmission and duplicate pending submissions;
- login and request rate limits;
- report and assistant scoping;
- supervisor write denial;
- directory privacy masking;
- GitHub signature rejection and task-link validation;
- rejection of unsafe URL schemes.

### Production non-intrusive smoke tests

15/15 checks passed:

- `GET /api/v1/health` → `200`; production environment metadata is hidden.
- API responses carry `Cache-Control: no-store`.
- Unauthenticated `/api/v1/tasks` → `401`.
- `POST /api/v1/setup/initialize` with an invalid token → `403`.
- Cross-origin login → `403 ORIGIN_DENIED`.
- Static app shell → `200`.
- CSP, HSTS, `nosniff`, and frame-denial headers are present.
- Unauthenticated attachment listing → `401`.
- GitHub webhook with integration disabled → `503 INTEGRATION_DISABLED`.
- Exact-origin CORS preflight → `204` with the exact production origin.

### Production D1

- 7 active users.
- 30 tasks.
- 1 active administrator.
- 2 last-admin triggers.
- 3 integrity unique indexes from migration `0007`.

## Residual risks and open items

| Item | Status | Notes |
|---|---|---|
| R2 attachment storage | Blocked | Cloudflare returns `10042`; R2 is not enabled and the Wrangler OAuth token lacks R2 management scope. Production has no `ATTACHMENTS` binding, so attachment routes are expected to return `503 ATTACHMENTS_UNAVAILABLE`. The source `wrangler.jsonc` still declares the bucket for future activation. |
| Deploy without R2 | Operational workaround | Deploy with a temporary dist config that sets `r2_buckets: []`; do not commit that temporary config. `npm run deploy` will fail until R2 is enabled and the bucket exists. |
| Email delivery | Unverified | No Resend or Cloudflare Email credentials are configured; delivery code is provider-gated. |
| GitHub outbound actions | Unverified | No `GITHUB_TOKEN` or complete GitHub App credentials are configured; sync and pull-request creation return `503 GITHUB_NOT_CONFIGURED`. |
| MFA | Not implemented | Password-only authentication remains. TOTP/WebAuthn is the recommended next control. |
| Session lifetime | Hardened, not ideal | Sessions use 7-day expiry; there is no explicit idle timeout and no rotation on every privilege change. Password reset revokes all sessions. |
| Webhook secret storage | Known limitation | The configured webhook secret is stored in `integration_settings` in D1. Prefer an environment secret and clear the database copy where possible. |
| Initial credentials file | User action required | `C:\Users\mosta\Documents\CERBERUS_PRODUCTION_INITIAL_CREDENTIALS.json` is user-only but plaintext. Move it to an approved secret store or delete it after all temporary passwords are replaced. |
| Member-visible status/roles | Partially mitigated | Email, bio, and last-activity are masked for ordinary members; status and role labels remain visible in the directory. |
| Submission summaries | Product decision | Task/checkpoint detail exposes submission summaries to authenticated team members; only attachment binaries and submission-attachment metadata are restricted. If reviewer-only summaries are required, the detail queries need the same ACL. |
| Malware scanning | Not implemented | Uploaded files are private, checksummed, and downloaded as attachments, but are not antivirus-scanned. |
| Backup restore | Verification-only | Restore is intentionally non-destructive; a tested restore drill has not been performed. |
| Dev-tooling vulnerabilities | Tracked | The full audit reports 12 findings in Vitest/Wrangler/Tailwind tooling; production dependencies are clean. Upgrade in a dedicated maintenance change. |

## Recommended next actions

1. Enable R2 in the Cloudflare dashboard, create the private `cerberus-attachments` bucket, and redeploy the source configuration with the `ATTACHMENTS` binding; then verify upload, list, download, and audit records in production.
2. Store the webhook secret in Worker secrets, remove any plaintext copy from D1, and rotate it once the production webhook is configured.
3. Configure email and GitHub credentials, then run live delivery, sync, and pull-request tests.
4. Add TOTP MFA and an idle-session timeout; consider rotating sessions on role changes.
5. Decide whether submission summaries must be reviewer-only. If yes, apply the same resource ACL used for submission attachments.
6. Move or delete the initial credentials file and confirm every temporary password has been replaced.
7. Address the dev-tooling audit findings in a separate dependency-maintenance change.
