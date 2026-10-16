# CERBERUS WORKSPACE

Private engineering collaboration software for the CERBERUS graduation project. This repository currently implements the secure foundation plus the first end-to-end task submission and administrative review workflow. See [checkpoint status](docs/CHECKPOINTS.md) for precise scope and limitations.

## Implemented now

- Cloudflare Workers + Static Assets deployment with a Hono API and React client.
- D1 schema and migration for the full workspace domain foundation.
- Seven identities with unique random temporary passwords that are disclosed only once during initialization.
- Mandatory first-login password replacement, PBKDF2 password hashes, opaque sessions, HttpOnly cookies, CSRF protection, login throttling, logout, account suspension, role/permission enforcement, and audit logs.
- Mostafa's single dual-role identity with member/admin workspace switching.
- Six persisted engineering roadmaps: 30 milestones, 30 checkpoints, detailed seed tasks, checklists, and acyclic dependencies.
- Persisted task search, detail, checklist, evidence submission, review queue, approval/change request, notifications, and progress events.
- Role-specific persisted dashboards and supervisor-safe progress reads.

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

The response contains seven unique temporary credentials. Store them in a private, gitignored location and send each password only to its intended person. Every workspace API is blocked until that person replaces the temporary password on first login. Seed email addresses use the reserved `.local` domain and should be updated through the forthcoming admin identity workflow before production use.

## Verification

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

## Cloudflare deployment preparation

1. Authenticate Wrangler: `npx wrangler login`
2. Create D1: `npx wrangler d1 create cerberus-workspace`
3. Replace `REPLACE_WITH_D1_DATABASE_ID` in `wrangler.jsonc` with the returned ID.
4. Set bootstrap secret: `npx wrangler secret put SETUP_TOKEN`
5. Apply migrations: `npm run db:migrate:remote`
6. Deploy: `npm run deploy`
7. Call `/api/v1/setup/initialize` once using the setup secret, save the one-time temporary credentials, then rotate or delete the setup secret.

Production must set `APP_ENV` to `production` and `APP_ORIGIN` to the exact deployed HTTPS origin. External integrations are intentionally disabled until their credentials and later checkpoints are implemented. Never commit `.dev.vars` or provider credentials.

## Security notes

- Passwords use Web Crypto PBKDF2-SHA-256 with per-password salts and 310,000 iterations.
- Temporary passwords are unique per account; authenticated users with `must_change_password` set cannot access workspace APIs until replacement.
- Session tokens are random and only SHA-256 hashes are stored; the cookie is HttpOnly, SameSite Strict, and Secure in production.
- State-changing authenticated requests require the per-session CSRF value.
- Authorization is enforced in the Worker. Client-side navigation is not a security boundary.
- A submitter cannot administratively review their own submission, including Mostafa in member mode.
- Uploaded binaries are not stored in D1 and R2 is not used.

## Known limitations

WS-05 through WS-12 are not complete. Account recovery, invitation reissue, full administrative editors, messaging, GitHub App/webhook handling, wiki UI, hardware/experiment workflows, AI provider adapter, PDF reports, backup tooling, and end-to-end browser tests remain. Database tables for several later modules are foundations, not claims of completed functionality.
