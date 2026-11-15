# Security audit report — cerberus-workspace

Run `cerberus-workspace-run-1`, profile `standard`, generated 2026-11-14.

## 1. Run profile, scope, and execution boundary

| Field | Value |
| --- | --- |
| Target | `F:\UserData\Desktop\proj\cerberus-workspace` |
| Source ref | `fe25862` (dirty: untracked `docs/TEAM_ROLES_2026-11-12.md` only) |
| Profile | `standard` |
| Scope | `worker/`, `shared/`, `src/`, `db/migrations/`, `scripts/`, `tests/`, build and deploy configuration, `.github/` |
| Excluded | `node_modules/`, `dist/`, `.wrangler/`, `coverage/` |
| Budget | none set by the owner |
| Execution policy | `sandboxed-source-and-local-only` |
| Prior runs | none (no prior `coverage-ledger.json` / `findings.json` pair exists) |
| Output | `C:/Users/mosta/security-audit-skill/cerberus-workspace/run-1` |

### Execution boundary

The host has no OS-enforced sandbox: no Docker, no WSL, no network namespace, no read-only mount. Target-controlled execution was therefore excluded, and the audit is source-only. Every behavioural claim that needs a running Worker or a concurrent request is recorded as `needs_validation`, not as a finding. This run has **zero confirmed records**; that is a limit of the execution boundary, not a statement that the target is clean.

### Deviations and limits (disclosed in full)

1. **Hunting was parent-performed.** The hunting wave was not delegated to independent hunter agents: a subagent invocation failed at the model usage limit, so the parent reviewed source for all 26 coverage units itself. The mitigation is Phase 5: every retained `needs_validation` record and the single rejection were re-checked by fresh verifiers that did not participate in hunting.
2. **No target execution.** As above, zero `confirmed` records and no reproduction of any race.
3. **Validators were run from patched copies.** The shipped `validate-coverage-ledger.cjs` and `validate-findings.cjs` refuse to run on win32 because `fs.constants.O_NOFOLLOW` and `O_NONBLOCK` are `0` there. Copies under `%TEMP%\opencode\validators\` relax only that gate, replacing the descriptor no-follow guarantee with an `lstatSync` symlink rejection before `openSync`; no other rule was changed. Both validators pass on the final artifacts (`PASS: 26 coverage units valid`, `PASS: 8 findings valid`).
4. **One verifier round was retried** after hitting the same usage limit; all retries returned a structured decision, and no record was accepted on the strength of a malformed or prose-wrapped reply.
5. **Coverage is bounded, not exhaustive.** 26 units over roughly 191 files and 41k LOC is a `standard` pass, not a proof of absence. The LIKE-pattern construction found in the wiki route is also present in `worker/routes/tasks.ts:167` and `worker/routes/admin.ts:74` and is only partly mitigated in `worker/routes/hardware.ts:59`; that class was reviewed as part of U21 but not split into separate units.

### Coverage and critic result

| Status | Units |
| --- | --- |
| covered | 21 |
| candidate | 5 |
| blocked | 0 |
| deferred | 0 |
| out_of_scope | 0 |
| total | 26 |

The post-wave coverage critic found unmapped route mounts (wiki, hardware, experiments, collaboration, notifications, dashboard/setup/admin, issues/decisions/feedback) and client-side storage, which expanded the ledger from 18 to 26 units. Its accepted units are `U21`–`U28`; no proposed unit was left unassigned.

## 2. Security posture summary

The authorization discipline in this Worker is unusually consistent for its size. Every request re-reads `user_roles`, `roles`, and `role_permissions` in `requireAuth`, so a role change takes effect on the next request; each route states its own permission instead of relying on the client guard; supervisor read-only scope is enforced server-side on every write path; the review decision is guarded by a unique index and a `status=pending` predicate; and the password, TOTP-sealing, CORS, and CSV paths all use the safer primitive rather than a hand-rolled one.

No injection, no authentication bypass, no authorization bypass, and no secret exposure were found in source. The seven surviving leads cluster into three shapes: **check-then-act races** on single-use credentials and accounting caps (four leads), **lifecycle-freeze gaps** where an approved record stays editable in one dimension (one lead), and **one unbounded query input** that can turn a read endpoint into a 500 (one lead). The seventh is a policy question about factor enrollment.

## 3. Confirmed findings

None. No record reached `confirmed`, because confirmation requires a target-native bounded reproduction and this host provides no sandbox in which to run the Worker.

## 4. Confirmed finding detail

Not applicable; `FINDINGS-DETAIL.md` records the zero-confirmed result and what would promote each lead.

## 5. Needs validation

These are leads, not vulnerabilities. They carry no severity. Full traces, evidence, blockers, and plans are in `NEEDS-VALIDATION.md`.

| # | Lead | Unit | Boundary | Decisive blocker | Bounded local next step |
| --- | --- | --- | --- | --- | --- |
| 1 | TOTP replay protection is check-then-act and can be raced | U03 | `worker/routes/auth.ts:99` | No OS-enforced sandbox exists on this host (no Docker, no WSL, no network namespace, no read-only mount), so the target was not executed and no concurrent request was… | See `NEEDS-VALIDATION.md` |
| 2 | Concurrent recovery-code redemption can restore a consumed code | U03 | `worker/routes/auth.ts:165` | The decisive step is runtime interleaving: auth.ts:117-119 and auth.ts:165-169 read and filter the array and auth.ts:217 commits the batch, so the source proves the… | See `NEEDS-VALIDATION.md` |
| 3 | Password-reset tokens are redeemed with a non-atomic check-then-act | U01 | `worker/routes/auth.ts:291` | No OS-enforced sandbox exists on this host (no Docker, no WSL, no network namespace, no read-only mount), so the Worker was not started and no concurrent request pair… | See `NEEDS-VALIDATION.md` |
| 4 | Daily effort cap is enforced with a non-atomic sum check | U07 | `worker/routes/tasks.ts:404` | No OS-enforced sandbox exists on this host (no Docker, no WSL, no network namespace, no read-only mount), so the target was not executed and no concurrent request was… | See `NEEDS-VALIDATION.md` |
| 5 | Attachments on an approved task can still be added or archived | U09 | `worker/routes/attachments.ts:98` | docs/CHECKPOINTS.md:55 documents task attachments as resource-level upload authorization with soft archival and an audit record, and the repository's immutability… | See `NEEDS-VALIDATION.md` |
| 6 | Wiki search binds raw input into an unbounded, unescaped LIKE pattern | U21 | `worker/routes/workspace-modules.ts:34` | The 50-byte LIKE ceiling is D1 engine behaviour: the source only records it in the comment at worker/services/search.ts:33-37, and this audit did not execute D1, so… | See `NEEDS-VALIDATION.md` |
| 7 | MFA enrollment and confirmation accept the session without the current password | U03 | `worker/routes/account.ts:177` | Session acquisition is not decidable from source | See `NEEDS-VALIDATION.md` |

## 6. Hardening notes and positive source patterns

### Hardening notes (not findings)

- **U16** — safeMarkdownUrl returns any value starting with a slash, so a protocol-relative //host link survives; the practical impact is low because absolute https links are already permitted, but rejecting // would match the stated allowlist.
- **U25** — PATCH /admin/settings stores any key and any JSON value supplied by an administrator; it is admin-only, but an allow-list of known keys would keep the settings table from becoming an untyped store.
- **U09** — canView returns true for task, checkpoint, bug, blocker, and experiment attachments for every authenticated user, which matches the team-wide transparency model but is broader than the submission rule.
- **U09** — evidence.post-approval-attachment-mutation survived verification with a corrected surface: the exercisable path is the task attachment panel (task-detail-page.tsx:471, canWork at :299), because the review queue reads submission_evidence (reviews.ts:226) and no client renders attachments for resourceType=submission. Attachments on an approved task can still be uploaded and archived while tasks.status and approved_at stay unchanged.
- **U09** — The submission branch of canAttach (attachments.ts:48) has the same missing status predicate, but it is unreachable from the shipped client; it stays recorded as a latent gap rather than a demonstrated one.
- **U03** — verifyTotp explicitly documents that callers must reject a consumed step, so the missing conditional update is a contract gap rather than an unknown requirement.
- **U03** — Two concurrent /mfa/confirm calls can both return recovery codes while only one set is persisted, because the UPDATE is guarded by confirmed_at IS NULL but the response is not.
- **U01** — The reset request invalidates older tokens (auth.ts:253) but the redemption path does not re-check the token row after the batch, so a lost race is silent.
- **U02** — Recovery codes carry about 40 bits of entropy and are stored as unsalted SHA-256, so a database disclosure would allow offline enumeration; a keyed hash or longer code would raise the cost.
- **U07** — Archiving a task (tasks.ts:463-474) does not withdraw a pending submission for that task, so an administrator can archive work that is still awaiting review.
- **U06** — A candidate (workflow.reassign-pairing-gap) was raised and then rejected in Phase 5: POST /users/:id/reassign-work requires workspace.admin, which db/migrations/0001_foundation.sql:413 grants only to role_admin alongside task.manage and review.admin, so moving a task without its checkpoint crosses no trust boundary. The rejected record is retained in findings.json so a future run does not restate it without changed evidence.
- **U06** — The endpoint reports reassignedTasks and reassignedCheckpoints separately (users.ts:197) and the member dialog states that approved records remain approved (members-page.tsx:897), so independent selection is the documented contract of an administrative transfer.
- **U21** — GET /decisions is registered twice (workspace-modules.ts:88 and :91); the second handler is unreachable dead code.
- **U21** — Issue resolution (workspace-modules.ts:95) writes no audit row, unlike the other administrative transitions.
- **U21** — The raw LIKE bind at workspace-modules.ts:39 is not unique: tasks.ts:167 and admin.ts:74 bind raw patterns too, and hardware.ts:59 escapes without a byte budget, so the same class should be reviewed as one sweep rather than per route.
- **U26** — Supervisor feedback accepts any memberId without confirming that the target belongs to the workspace.

### Positive source patterns

- Password storage uses PBKDF2-SHA256 with a per-hash salt, 100,000 iterations, and `timingSafeCompare`; unknown accounts still run a dummy comparison so login timing does not disclose existence.
- TOTP secrets are sealed with AES-256-GCM and `user_mfa:<user id>` as additional authenticated data; production without a valid key fails closed with `503 MFA_UNAVAILABLE` instead of storing plaintext.
- Session, reset, and activation tokens are 32 random bytes stored as SHA-256 hashes; the session cookie is `__Host-`, `HttpOnly`, `SameSite=Strict`, and `Secure` in production.
- CORS fails closed in production: an exact `APP_ORIGIN` match, no wildcard, and a `204` preflight only for the configured origin.
- The review decision is atomic in effect: `status=pending` in the UPDATE plus `reviews_submission_unique_idx`, so a second reviewer aborts the whole D1 batch.
- Hardware checkout carries its availability predicate inside the `INSERT ... SELECT` and rejects a zero change count, which closes the obvious quantity race.
- CSV export prefixes formula-leading cells; the PDF path normalizes typography; `sanitize-html` 2.18.1 is pinned; `skipHtml` plus a URL allowlist covers Markdown; no `dangerouslySetInnerHTML`, `innerHTML`, `eval`, or `new Function` exists in `src/`.
- Two database triggers protect the last administrator, and administrative transitions write audit rows plus workspace events.
- Production configuration holds only `APP_ENV` and `APP_ORIGIN`; `.dev.vars` is gitignored and the build script fails if a secret value appears in a bundle.

## 7. Coverage summary and dispositions

- 26 units: 21 covered, 5 candidate. Nothing was deferred, blocked, or left out of scope.
- 7 records retained as `needs_validation`; every one passed Phase 5 independent verification (with the non-material corrections noted above).
- 1 record retained as `rejected`: `workflow.reassign-pairing-gap`. It was disproved because `workspace.admin` is granted only to `role_admin`, which already holds `task.manage` and `review.admin`, so moving a task without its checkpoint crosses no trust boundary. It is kept so a future run does not restate it without changed evidence.
- Ledger unit `U06` was closed as `covered` after that rejection; its candidate fingerprint is retained in the hardening note and in `findings.json`.
- No confirmed record exists, and none is implied by the leads above.
