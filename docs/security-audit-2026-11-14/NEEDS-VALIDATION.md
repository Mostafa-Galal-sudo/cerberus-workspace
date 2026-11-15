# Needs validation — cerberus-workspace

Run `cerberus-workspace-run-1`, profile `standard`, generated 2026-11-14. These are prioritized leads without severity. None is a confirmed vulnerability: each needs one bounded observation that this host could not produce without executing the target.

## Priority order and why

| # | Lead | Unit | Why this position |
| --- | --- | --- | --- |
| 1 | TOTP replay protection is check-then-act and can be raced | U03 | One TOTP step and one challenge token can authenticate twice; affects the second factor directly. |
| 2 | Concurrent recovery-code redemption can restore a consumed code | U03 | Restores a consumed recovery code, which weakens the break-glass credential after it was used. |
| 3 | Password-reset tokens are redeemed with a non-atomic check-then-act | U01 | A one-time reset token can be redeemed twice, letting the later writer choose the password. |
| 4 | Daily effort cap is enforced with a non-atomic sum check | U07 | Breaks an accounting control that feeds planning and effort reports; single-member, low privilege. |
| 5 | Attachments on an approved task can still be added or archived | U09 | Evidence attached to an approved task stays editable; integrity of the review record. |
| 6 | Wiki search binds raw input into an unbounded, unescaped LIKE pattern | U21 | Self-inflicted 500 on a read endpoint; no disclosure. |
| 7 | MFA enrollment and confirmation accept the session without the current password | U03 | Absence of password re-auth on enrollment; whether it is a defect is an owner policy decision. |

## 1. TOTP replay protection is check-then-act and can be raced

`auth.totp-step-race` · unit `U03` · verdict `needs_validation`

**Description.** Replay protection is check-then-act. The handler snapshots user_mfa.last_used_step when it loads the challenge, accepts the verified step when it is greater than that snapshot, and later writes the accepted step with an UPDATE whose only predicate is user_id. The challenge is consumed by a conditional UPDATE, but its affected-row count is discarded and createSession runs regardless. Two concurrent requests that present the same valid code and the same unconsumed challenge token both pass the snapshot comparison and both receive a session, so one TOTP step can authenticate more than one login and one challenge token can be redeemed twice.

**Claimed root cause (source-stated only).** auth.ts:162 compares the verified step with the snapshot value read at auth.ts:119, and auth.ts:202 writes it with only WHERE user_id = ?, so the step update is not a compare-and-swap. The challenge consumption at auth.ts:195 is conditional, but auth.ts:217 awaits the batch without reading meta.changes and auth.ts:220 calls createSession unconditionally, so losing the consumption race does not stop session creation.

**Trace.**

| Step | Kind | Location | Operation |
| --- | --- | --- | --- |
| 1 | entrypoint | `worker/routes/auth.ts:99` | POST /api/v1/auth/login/mfa — Registers the MFA verification route, which accepts a challengeToken and a six-digit code. |
| 2 | propagation | `worker/routes/auth.ts:119` | challenge and factor snapshot — The challenge query reads m.last_used_step and m.recovery_codes_json, fixing the replay state at request start. |
| 3 | propagation | `worker/routes/auth.ts:162` | step comparison — Accepts the verified step only when it is greater than the snapshot value. |
| 4 | propagation | `worker/routes/auth.ts:195` | challenge consumption — Consumes the challenge with a conditional UPDATE whose affected-row count is never checked. |
| 5 | sink | `worker/routes/auth.ts:220` | createSession — Issues the session unconditionally after the batch, so both racing requests receive cookies. |

**Evidence.**

| Location | What the source shows |
| --- | --- |
| `worker/services/mfa.ts:73` | The verifier comment states that callers are responsible for rejecting a previously consumed step (replay). |
| `worker/routes/auth.ts:202` | The step update has only WHERE user_id = ? and no affected-row check. |
| `worker/routes/auth.ts:217` | The batch result is awaited for completion only; meta.changes from the conditional consumption is discarded. |

**Blockers (why this is not confirmed).**

- No OS-enforced sandbox exists on this host (no Docker, no WSL, no network namespace, no read-only mount), so the target was not executed and no concurrent request was issued.
- The claim depends on two independent requests both reading last_used_step before either batch commits; that interleaving is a property of the D1 runtime and request scheduling, not of the repository, and it was not observed here.

**Resolution plan.**

**Local, bounded:** Against a dev Worker with local D1, seed a member with a confirmed TOTP factor and a known secret. Run 20 rounds: set user_mfa.last_used_step to NULL, obtain a challengeToken from POST /api/v1/auth/login, and fire two concurrent POST /api/v1/auth/login/mfa requests with that same challengeToken and the current six-digit code; record both statuses and the delta in sessions rows for the member. Any round with two 200 responses and two sessions from one challenge token confirms the claim. Control: two sequential requests using a fresh challenge and the same code return one 200 and one 401 MFA_CODE_INVALID, as tests/integration/phase3-security.test.ts:172-179 asserts.

**Owner-observed, no audit traffic:** None required, and no production request should be sent: login_events has no TOTP step column (db/migrations/0010_phase3_assistant_security.sql:55-65) and user_mfa stores only the latest step, so a production log review cannot decide this candidate.

## 2. Concurrent recovery-code redemption can restore a consumed code

`auth.recovery-code-race` · unit `U03` · verdict `needs_validation`

**Description.** The login handler parses the recovery-code hash array from the challenge snapshot, filters the matched index out in application memory, and writes the whole array back to user_mfa. Two concurrent logins with two different valid recovery codes each write an array that is missing only their own code, so whichever batch commits last restores the code the other request consumed. A credential that is meant to be single-use becomes usable again for an actor who already holds the account password and two recovery codes.

**Claimed root cause (source-stated only).** The recovery-code array is read with the challenge at worker/routes/auth.ts:117-119, filtered in memory at auth.ts:169, and written back whole at auth.ts:205 with only WHERE user_id = ?: no compare-and-swap, no conditional deletion of the matched hash, and no affected-row check.

**Trace.**

| Step | Kind | Location | Operation |
| --- | --- | --- | --- |
| 1 | entrypoint | `worker/routes/auth.ts:165` | POST /api/v1/auth/login/mfa — Parses the recovery hashes from the challenge snapshot that auth.ts:117-119 loaded before verification. |
| 2 | propagation | `worker/routes/auth.ts:169` | remaining hash computation — Filters the matched index out of the snapshot array in application memory. |
| 3 | sink | `worker/routes/auth.ts:205` | user_mfa recovery_codes_json — Writes the whole remaining array back with no compare-and-swap predicate, overwriting a concurrent write of another array. |

**Evidence.**

| Location | What the source shows |
| --- | --- |
| `worker/services/mfa.ts:109` | matchRecoveryCode returns the index of the matching hash and does not mutate storage. |
| `worker/routes/auth.ts:205` | The update binds the complete JSON array rather than deleting one hash conditionally. |
| `tests/integration/phase3-security.test.ts:216` | The suite asserts that redeeming an already-consumed recovery code returns 401, so single use is the intended property that the race breaks. |

**Blockers (why this is not confirmed).**

- The decisive step is runtime interleaving: auth.ts:117-119 and auth.ts:165-169 read and filter the array and auth.ts:217 commits the batch, so the source proves the missing compare-and-swap but not that two requests both pass the read before either batch commits. That ordering depends on Worker isolate scheduling and D1 statement interleaving.
- A sequential run cannot show it: tests/integration/phase3-security.test.ts:195-216 already covers one recovery-code login followed by a rejected reuse, so the candidate needs two requests in flight across the read-to-batch window, and this audit issued no request.

**Resolution plan.**

**Local, bounded:** In the existing vitest-pool-workers harness (vitest.integration.config.ts:9-14, tests/integration/helpers.ts:88-99), seed user_mfa for an active member with confirmed_at = unixepoch(), a readable secret (a legacy plaintext base32 value is accepted, worker/services/mfa-secret.ts:89-90), and recovery_codes_json holding hashRecoveryCode('AAAA-AAAA') and hashRecoveryCode('BBBB-BBBB'). Mint two challenges with two POST /api/v1/auth/login calls using the test password, then start both POST /api/v1/auth/login/mfa calls (code A, code B) without awaiting the first and, if needed, hold the first request batch at auth.ts:217 in a test-only D1 wrapper until the second request has passed auth.ts:117. Repeat the pair at most 20 times, read user_mfa.recovery_codes_json after each pair, and if a consumed code reappears, redeem it through a fresh challenge and confirm the 200. A reappearing code confirms the candidate; 20 pairs without overlap leave it unconfirmed rather than refuted.

**Owner-observed, no audit traffic:** No request is needed against the production deployment; the candidate is decidable in the local harness. If the owner wants to look for a real occurrence, login_events rows with method='recovery_code' are read-only evidence, but they cannot show the stored array.

## 3. Password-reset tokens are redeemed with a non-atomic check-then-act

`auth.reset-token-race` · unit `U01` · verdict `needs_validation`

**Description.** POST /api/v1/auth/reset-password selects the token row with used_at IS NULL and expires_at in the future, then hashes the new password (PBKDF2, 100,000 iterations) and only afterwards marks the token used inside a batch. The claim is a plain check-then-act: two requests holding the same token can both pass the SELECT before either batch commits, both write users.password_hash, and the batch that commits last decides the password. The token is documented as one-time, so the losing request returns a normal 200 instead of RESET_TOKEN_INVALID, and if a second holder of the link wins that ordering its password replaces the one set by the first redemption.

**Claimed root cause (source-stated only).** The used_at IS NULL predicate exists only in the SELECT at auth.ts:304-307 and in a user-wide sweep at auth.ts:316; the row-level UPDATE at auth.ts:315 matches on id alone with no used_at IS NULL predicate and no affected-row check, and the batch writes users.password_hash unconditionally at auth.ts:314, so a redemption that loses the race still commits.

**Trace.**

| Step | Kind | Location | Operation |
| --- | --- | --- | --- |
| 1 | entrypoint | `worker/routes/auth.ts:291` | POST /api/v1/auth/reset-password — Unauthenticated route that redeems a password-reset token; no session or CSRF check guards it. |
| 2 | propagation | `worker/routes/auth.ts:306` | password_reset_tokens SELECT — Selects the token by hash with used_at IS NULL and expires_at > unixepoch(); the read does not reserve or claim the row. |
| 3 | propagation | `worker/routes/auth.ts:312` | password hashing — Hashes the new password before any conditional claim on the token, widening the window between the SELECT and the write. |
| 4 | sink | `worker/routes/auth.ts:315` | password_reset_tokens update — Marks the token used by id with no used_at IS NULL predicate, in the same batch that overwrites users.password_hash at line 314. |

**Evidence.**

| Location | What the source shows |
| --- | --- |
| `worker/routes/auth.ts:253` | A new reset request invalidates older tokens, showing the intended one-time semantics. |
| `worker/routes/auth.ts:316` | The follow-up statement marks all remaining tokens for the user used, but it runs after the password write and cannot undo a lost race. |
| `db/migrations/0005_password_reset_tokens.sql:1` | The migration states the links are one-time and that only the SHA-256 digest is persisted, so no plaintext token can be recovered from D1. |
| `worker/services/email.ts:25` | email_outbox stores recipient, subject, provider, status and error only, so the reset URL is not recoverable from the outbox either. |
| `worker/routes/users.ts:242` | The administrative reset route returns data.token in the response, which is the only way to obtain a plaintext token for a local reproduction. |

**Blockers (why this is not confirmed).**

- No OS-enforced sandbox exists on this host (no Docker, no WSL, no network namespace, no read-only mount), so the Worker was not started and no concurrent request pair was issued; the interleaving is therefore not demonstrated.
- Whether D1 schedules two separate HTTP requests such that both SELECTs complete before either batch commits is runtime behaviour of the D1 service, which the repository source cannot decide.

**Resolution plan.**

**Local, bounded:** As a local super_admin, call POST /api/v1/users/<member>/reset-password and keep data.token from the response, because password_reset_tokens stores only token_hash and email_outbox stores no body. Then issue two concurrent POST /api/v1/auth/reset-password requests with that token and two different passwords that satisfy passwordResetSchema. Expect two 200 {reset:true} responses and users.password_hash equal to one of the two submitted passwords; a correct implementation returns 400 RESET_TOKEN_INVALID for the second request.

**Owner-observed, no audit traffic:** Not required; the race is decidable on the local Worker and no request is sent to the production deployment.

## 4. Daily effort cap is enforced with a non-atomic sum check

`workflow.worklog-daily-cap-race` · unit `U07` · verdict `needs_validation`

**Description.** The worklog handler sums the hours already recorded for the member and date, rejects the request when the sum plus the new entry exceeds 24, and then inserts unconditionally. Two concurrent requests that each pass the check can leave more than 24 hours recorded for one day. The cap feeds the planning workload view and the effort reports, so the integrity of that accounting control can be broken.

**Claimed root cause (source-stated only).** SELECT SUM(hours) followed by INSERT with no database constraint, conditional insert, or transaction that re-checks the total.

**Trace.**

| Step | Kind | Location | Operation |
| --- | --- | --- | --- |
| 1 | entrypoint | `worker/routes/tasks.ts:404` | POST /api/v1/tasks/:id/worklogs — Authorizes the assignee or an administrator and validates the payload. |
| 2 | propagation | `worker/routes/tasks.ts:428` | daily total query — Sums the existing hours for the member and date outside any write transaction. |
| 3 | sink | `worker/routes/tasks.ts:436` | task_worklogs insert — Inserts the new entry without re-checking the total or relying on a constraint. |

**Evidence.**

| Location | What the source shows |
| --- | --- |
| `worker/routes/tasks.ts:430` | The only enforcement is the application comparison against 24. |
| `worker/routes/tasks.ts:436` | The insert has no guard and the schema has no per-day uniqueness constraint to make the cap atomic. |

**Blockers (why this is not confirmed).**

- No OS-enforced sandbox exists on this host (no Docker, no WSL, no network namespace, no read-only mount), so the target was not executed and no concurrent request was issued.
- The candidate requires two concurrent requests from the same member, which a single authenticated member can issue.

**Resolution plan.**

**Local, bounded:** With a local member assigned to a task, fire two concurrent POST /api/v1/tasks/<task>/worklogs calls with 13 hours each on the same date, then sum the rows for that member and date.

## 5. Attachments on an approved task can still be added or archived

`evidence.post-approval-attachment-mutation` · unit `U09` · verdict `needs_validation`

**Description.** attachments.ts authorizes a task attachment from assignee identity (or task.manage) plus a non-archived task row, and authorizes deletion from uploader identity or workspace.admin; neither handler reads tasks.status or tasks.approved_at. The task detail page renders the evidence attachment panel for every task and derives canUpload from canWork, which does not depend on status, so after a reviewer approves the task the assignee can still upload a new file or archive a file they uploaded before approval. The task stays approved with approved_at intact, the review row is untouched, no notifications row is written (only attachment.created and attachment.archived workspace_events plus attachment audit rows), and the task keeps satisfying the checkpoint gate that only counts mandatory tasks whose status is not approved. The submission branch of canAttach has the same omission, but the only AttachmentPanel render site uses resourceType="task" and the review queue reads submission_evidence rows only, so the exercisable product surface is the task attachment panel.

**Claimed root cause (source-stated only).** attachments.ts:41 selects assignee_id for a task row filtered on archived_at IS NULL, and attachments.ts:42 grants on assignee identity or task.manage; the delete path at attachments.ts:217 grants on uploader identity or workspace.admin. Neither gate consults tasks.status or tasks.approved_at, while tasks.ts:541 and tasks.ts:663 lock the same approved task against status changes and re-submission, and reviews.ts:377 is the only writer of tasks.status='approved' because updateTaskStatusSchema excludes that value.

**Trace.**

| Step | Kind | Location | Operation |
| --- | --- | --- | --- |
| 1 | entrypoint | `worker/routes/attachments.ts:98` | POST /api/v1/attachments — Authenticated upload route; the route middleware at line 14 requires only authentication and a completed password change. |
| 2 | propagation | `worker/routes/attachments.ts:41` | canAttach task branch — Selects assignee_id for a task whose archived_at IS NULL; line 42 returns true for the assignee or task.manage, so an approved task passes the same check as an active one. |
| 3 | propagation | `worker/routes/attachments.ts:132` | upload authorization gate — The gate calls canAttach and returns 403 only when the caller is neither the assignee nor task.manage; no task status is consulted. |
| 4 | propagation | `worker/routes/attachments.ts:150` | attachments insert — Inserts the attachment row for the approved task after the object is stored under the task resource key. |
| 5 | sink | `worker/routes/attachments.ts:223` | DELETE archive statement — Archives the attachment by id alone; line 233 then deletes the stored object, with no task status predicate. |

**Evidence.**

| Location | What the source shows |
| --- | --- |
| `src/features/tasks/task-detail-page.tsx:471` | The evidence attachment panel is rendered for every task, with canUpload passed as canWork or isAdmin and no status condition. |
| `src/features/tasks/task-detail-page.tsx:299` | canWork is assignee identity plus supervisor exclusion only; task status is not part of the expression, so the panel stays writable after approval. |
| `src/components/attachment-panel.tsx:114` | The archive control is shown to the attachment owner regardless of the task status. |
| `worker/routes/tasks.ts:541` | The same approved task rejects status changes with REVIEW_DECISION_REQUIRED, so the record is locked while its attachments are not. |
| `worker/routes/tasks.ts:663` | An approved task also rejects re-submission, so no later review cycle can capture the changed evidence. |
| `worker/routes/tasks.ts:115` | Checkpoint submission only counts mandatory tasks whose status is not approved, so an approved task keeps the gate satisfied after its attachments change. |
| `worker/routes/reviews.ts:226` | The review queue evidence is read from submission_evidence, not from attachments, so submission attachments are not the decision input. |
| `worker/routes/reviews.ts:377` | Approval is written to tasks.status and tasks.approved_at by the review decision only, and it touches no attachment row. |
| `docs/CHECKPOINTS.md:55` | Documented attachment behavior is resource-level upload authorization, audited downloads, and soft archival; no status freeze is described. |
| `src/features/dashboard/dashboard-page.tsx:40` | The admin dashboard copy claims the approval record is immutable, which the attachment path does not extend to evidence files. |

**Blockers (why this is not confirmed).**

- docs/CHECKPOINTS.md:55 documents task attachments as resource-level upload authorization with soft archival and an audit record, and the repository's immutability statements cover the wiki version history (README.md:21, docs/CHECKPOINTS.md:62), the audit ledger (src/features/tasks/task-detail-page.tsx:1193), the export checksum (src/features/admin/admin-command-center-page.tsx:367), and the dashboard approval-record copy (src/features/dashboard/dashboard-page.tsx:40); none of them states whether the attachment set attached to an approved task is frozen, and the existing attachment audit and workspace-event rows show changes are recorded rather than blocked, so source alone cannot decide whether post-approval attachment mutation is a defect or intended behavior.
- Whether a supervisor or external reviewer treats the attachment set as a frozen snapshot at approval time is a process fact outside the repository, and because the review queue consumes submission_evidence rather than attachments, the consequence beyond a mutable evidence record cannot be established from source.

**Resolution plan.**

**Local, bounded:** Using the repository isolated local stack (wrangler.test.jsonc binds ATTACHMENTS to the local R2 simulation and the integration suite already runs the real Worker against isolated D1), pick one task assigned to a member whose required checklist items are complete and whose dependencies are approved; sign in as that member and POST /api/v1/tasks/:id/submissions with a summary and one evidence entry; sign in as a review.admin and POST the review decision with result=approved; then, as the assignee, POST /api/v1/attachments with resourceType=task, that task id and a small file, and DELETE one attachment the assignee uploaded before approval. Assert 201 and 200, tasks.status still 'approved' with an unchanged approved_at, no new reviews row, and no new notifications row beyond the attachment.created and attachment.archived workspace_events and attachment audit rows.

**Owner-observed, no audit traffic:** The owner states whether an approved task's attachment set must be frozen and whether the graduation review consumes a snapshot; no request is sent to production, where docs/CHECKPOINTS.md:111 records that attachment routes return 503 ATTACHMENTS_UNAVAILABLE.

## 6. Wiki search binds raw input into an unbounded, unescaped LIKE pattern

`search.wiki-like-pattern-unbounded` · unit `U21` · verdict `needs_validation`

**Description.** GET /api/v1/workspace/wiki (worker/routes/workspace-modules.ts:34) builds its SQL LIKE pattern directly from the `search` query string and executes it against wiki_pages.title and wiki_versions.content_markdown. The handler applies neither of the two controls used by the shared search service in worker/services/search.ts: escapeLikePattern (line 29) is not called, so % and _ keep their wildcard meaning, and no byte budget is applied, so the pattern length follows the input. The service comment at worker/services/search.ts:33-37 records that D1 rejects LIKE patterns longer than 50 bytes with "LIKE or GLOB pattern too complex", which is why MAX_LIKE_PATTERN_BYTES is 48. The handler also has no try/catch, so such an error propagates to app.onError (worker/index.ts:80-83) and becomes 500 INTERNAL_ERROR. The result is a self-inflicted 500 on a read endpoint for any authenticated member, not data disclosure: a short wildcard-heavy term only broadens the match inside the caller's existing wikiVisibilityFilter (worker/routes/workspace-modules.ts:37-38). This pattern construction is not unique to the wiki handler - worker/routes/tasks.ts:167 binds the same raw `%${search}%`, and worker/routes/admin.ts:74 binds `%${action}%` raw, both with neither escape nor length cap, while worker/routes/hardware.ts:59 escapes but still applies no byte budget - but this record covers only the wiki route.

**Claimed root cause (source-stated only).** worker/routes/workspace-modules.ts:39 binds `%${search}%` twice, for p.title and v.content_markdown, with no escapeLikePattern call and no length cap, and the query at line 44 runs without a try/catch, so a D1 pattern error reaches app.onError (worker/index.ts:80-83) and returns 500. The shared service shows the two controls that are absent here: escapeLikePattern at worker/services/search.ts:29 and the 48-byte MAX_LIKE_PATTERN_BYTES budget at worker/services/search.ts:37, applied by buildLikePatterns at line 62.

**Trace.**

| Step | Kind | Location | Operation |
| --- | --- | --- | --- |
| 1 | entrypoint | `worker/routes/workspace-modules.ts:34` | GET /api/v1/workspace/wiki — Route registration for the wiki list; the router is mounted at /api/v1/workspace by worker/index.ts:74, so the handler is reachable at /api/v1/workspace/wiki. |
| 2 | propagation | `worker/routes/workspace-modules.ts:35` | search query read — Reads c.req.query('search') and trims it; no maximum length is applied. |
| 3 | propagation | `worker/routes/workspace-modules.ts:39` | LIKE pattern construction — Pushes the raw term into `%${search}%` for both title and content_markdown, with no escapeLikePattern call and no byte budget, so % and _ keep their wildcard meaning and the pattern length follows the input. |
| 4 | sink | `worker/routes/workspace-modules.ts:44` | D1 prepare/all — Executes the query with no try/catch; a D1 pattern error propagates to app.onError. |

**Evidence.**

| Location | What the source shows |
| --- | --- |
| `worker/services/search.ts:29` | escapeLikePattern escapes the LIKE metacharacters for callers that invoke it; the wiki handler does not call it. |
| `worker/services/search.ts:37` | MAX_LIKE_PATTERN_BYTES is 48, with a comment at lines 33-37 recording that D1 rejects LIKE patterns longer than 50 bytes as "LIKE or GLOB pattern too complex". |
| `worker/services/search.ts:62` | buildLikePatterns applies the escape and the byte budget before the query is built, which the wiki handler bypasses. |
| `worker/routes/workspace-modules.ts:37` | The visibility filter is applied correctly (wikiVisibilityFilter, pushed at line 38), so the defect is confined to pattern construction, not to row scoping. |
| `worker/index.ts:80` | app.onError converts the thrown D1 error into 500 INTERNAL_ERROR for the request. |
| `worker/routes/hardware.ts:59` | A different route does call escapeLikePattern but applies no byte budget, so escaping is not exclusive to the shared service and the missing budget is not unique to the wiki handler. |
| `worker/routes/tasks.ts:167` | The task list binds the same raw `%${search}%` for title and description with neither escape nor length cap, so the construction is shared by more than one route. |
| `worker/routes/admin.ts:74` | The audit-log browser binds `%${action}%` raw under the `a.action LIKE ?` condition added at line 73, with neither escape nor length cap. |

**Blockers (why this is not confirmed).**

- The 50-byte LIKE ceiling is D1 engine behaviour: the source only records it in the comment at worker/services/search.ts:33-37, and this audit did not execute D1, so the 500 is inferred from that documented limit rather than observed.
- The source does not show whether D1 rejects the pattern at prepare time or only when the LIKE is evaluated against a row, so whether the request fails with zero visible wiki rows is unverified; whether the deployment currently holds any wiki page is deployment data, not source.

**Resolution plan.**

**Local, bounded:** In the repository's existing vitest-pool-workers harness (vitest.integration.config.ts, real Worker plus isolated D1, no network; run with npm run test:integration), seed accounts with the tests/integration/helpers seedUsers/login/call helpers, create one wiki_pages row with visibility 'members' and current_version 1 plus the matching wiki_versions row as the member, then call GET /api/v1/workspace/wiki?search=<100-character ASCII term> as that member and expect 500 with error.code INTERNAL_ERROR. Controls in the same run: a 5-character term returns 200, and a 5-character term of only '%' characters returns 200 including the seeded page, showing the failure tracks pattern length rather than wildcard use; an optional 40-character term brackets where the ceiling actually sits.

**Owner-observed, no audit traffic:** Not required; no request is sent to production. A read-only count of wiki_pages in the production D1 would only tell the owner whether the endpoint can fail there today and does not change the local result.

## 7. MFA enrollment and confirmation accept the session without the current password

`auth.mfa-enroll-no-reauth` · unit `U03` · verdict `needs_validation`

**Description.** POST /api/v1/account/mfa/setup and POST /api/v1/account/mfa/confirm are gated only by requireAuth plus requirePasswordChanged, and neither reads a password. A session holder on an account whose factor is not yet confirmed can take the secret returned by setup, confirm it, and leave the account bound to an authenticator they control. The resulting state is durable: once confirmed_at is set, POST /mfa/setup returns 409 MFA_ALREADY_ENABLED, POST /mfa/disable requires the password together with a TOTP or recovery code, and completing POST /auth/reset-password revokes sessions without deleting user_mfa, so removal requires POST /api/v1/users/:id/mfa/reset by a workspace.admin holder other than the affected account, which refuses self-reset. Setup and confirm do not revoke sessions, so an owner keeps any already-open session but cannot sign in again or change factor settings. The client sends an empty body to setup and only the code to confirm, and the integration suite exercises that password-less flow, so the behaviour is deliberate rather than an oversight in one handler; whether it is acceptable is the open question.

**Claimed root cause (source-stated only).** Factor enrollment trusts the session alone. worker/routes/account.ts:25 applies requireAuth and requirePasswordChanged to the whole account router; POST /mfa/setup at line 177 parses no body, and POST /mfa/confirm at line 221 accepts only { code } through mfaConfirmSchema (shared/schemas/account.ts:8). The sibling factor operations do re-authenticate: POST /mfa/disable at line 279 and POST /mfa/recovery-codes at line 333 call verifyPassword against users.password_hash before touching user_mfa.

**Trace.**

| Step | Kind | Location | Operation |
| --- | --- | --- | --- |
| 1 | entrypoint | `worker/routes/account.ts:177` | POST /api/v1/account/mfa/setup — Registered under the router-wide requireAuth plus requirePasswordChanged middleware (line 25). The handler reads no request body; its only preconditions are the per-user rate limit and the confirmed_at IS NULL check at line 185. |
| 2 | propagation | `worker/routes/account.ts:200` | user_mfa pending-secret upsert — INSERT INTO user_mfa ... ON CONFLICT(user_id) DO UPDATE writes the sealed secret with confirmed_at = NULL, last_used_step = NULL, and recovery_codes_json = '[]', so a session holder replaces any pending enrollment for that account. |
| 3 | propagation | `worker/routes/account.ts:221` | POST /api/v1/account/mfa/confirm — Loads the pending row by the session user id (line 231), rejects only when the row is missing or already confirmed (lines 233-238), and verifies the six-digit code against that secret; no password or step-up check is requested. |
| 4 | sink | `worker/routes/account.ts:259` | user_mfa confirmation — UPDATE user_mfa SET confirmed_at = unixepoch(), recovery_codes_json = ? ... WHERE user_id = ? AND confirmed_at IS NULL binds the session-chosen secret, stores the fresh recovery-code hashes, and returns those ten plaintext codes to the caller (line 264). No session row is updated. |

**Evidence.**

| Location | What the source shows |
| --- | --- |
| `worker/routes/account.ts:25` | accountRoutes.use('*', requireAuth, requirePasswordChanged) is the only middleware applied to the setup and confirm routes. |
| `shared/schemas/account.ts:8` | mfaConfirmSchema accepts only a six-digit code, while mfaDisableSchema at line 12 requires password plus code. |
| `worker/routes/account.ts:279` | POST /mfa/disable calls verifyPassword against users.password_hash and returns CURRENT_PASSWORD_INVALID before reading the factor. |
| `worker/routes/account.ts:333` | POST /mfa/recovery-codes calls verifyPassword against users.password_hash before regenerating codes. |
| `worker/routes/account.ts:185` | Setup returns MFA_ALREADY_ENABLED only when a factor is already confirmed, so the gap is limited to accounts without a confirmed factor. |
| `worker/routes/account.ts:309` | POST /mfa/disable is the only user-facing path that deletes the user_mfa row. |
| `worker/routes/auth.ts:317` | Completing a password reset revokes every session for the user but does not delete user_mfa, so an attacker-bound factor survives owner password recovery. |
| `worker/routes/users.ts:250` | Removal after takeover requires POST /api/v1/users/:id/mfa/reset with the workspace.admin permission; line 253 refuses SELF_MFA_RESET and line 274 deletes the row. |
| `src/features/account/account-security-page.tsx:112` | The setup mutation posts an empty body, and the confirm mutation at line 118 posts only { code }; the disable mutation at line 133 posts password plus code, so the client matches the server split. |
| `tests/integration/phase3-security.test.ts:134` | The integration suite performs setup with body {} and asserts confirm returns 200 at line 144, recording password-less enrollment as expected behaviour. |
| `worker/routes/auth.ts:402` | The session cookie is set httpOnly with sameSite Strict, so script access to the cookie is not an acquisition path. |

**Blockers (why this is not confirmed).**

- Session acquisition is not decidable from source. The session cookie is HttpOnly with SameSite=Strict (worker/routes/auth.ts:402), and this review found no route that mints a session for another account, so whether an attacker can hold a live session on an account without a confirmed factor depends on the deployment (endpoint compromise, shared workstation, reverse-proxy or log exposure, operator error) rather than on this repository.
- Whether enrollment must re-authenticate is an owner requirement, not a source fact. docs/CHECKPOINTS.md:150 records the password requirement for disabling only, and the client (account-security-page.tsx:112) plus tests/integration/phase3-security.test.ts:133-144 show password-less enrollment is the implemented and tested behaviour; source establishes that the control is absent, not that it is required.
- The recovery path after takeover depends on deployment data. users.ts:253 refuses self-reset, so if the affected account is the only workspace.admin holder the factor cannot be cleared without another administrator; whether the deployment has a second admin is not derivable from source.

**Resolution plan.**

**Local, bounded:** Add one test in tests/integration/ using the existing @cloudflare/vitest-pool-workers harness (real Worker, isolated D1, no network), modelled on tests/integration/phase3-security.test.ts:126-154: sign in as a member whose user_mfa row is absent; POST /api/v1/account/mfa/setup with body {} and assert 200 with a secret; POST /api/v1/account/mfa/confirm with a code derived from that secret and assert 200 with ten recovery codes; assert a second setup returns 409 MFA_ALREADY_ENABLED; assert /api/v1/account/mfa/disable with the correct password and an unrelated six-digit code returns 401 MFA_CODE_INVALID and leaves the row present; insert a password_reset_tokens row directly, complete /api/v1/auth/reset-password, and assert the following /api/v1/auth/login returns mfaRequired true; then call /api/v1/users/:id/mfa/reset as a second admin and assert the target user_mfa row is gone and password login succeeds.

**Owner-observed, no audit traffic:** The owner states whether factor enrollment is required to re-authenticate with the current password, whether the deployment exposes sessions outside the browser session (shared machines, proxy or log capture, endpoint compromise), and whether more than one workspace.admin holder exists. No request is sent to the production deployment.

## Not carried as leads

`workflow.reassign-pairing-gap` is retained in `findings.json` as `rejected` and is intentionally absent from this file.
