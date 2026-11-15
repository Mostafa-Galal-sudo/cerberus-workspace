# Findings detail — cerberus-workspace

Run `cerberus-workspace-run-1`, profile `standard`, generated 2026-11-14.

## Confirmed records

**Zero.** No record reached `confirmed`, so this file contains no reproduction. `FINDINGS-DETAIL.md` exists to carry the ordered trace, dummy principal, native input, observed output, conditions, and remediation for each confirmed `medium`, `high`, or `critical` record; with none, there is nothing to copy here.

## Why zero

A `confirmed` verdict requires a target-native bounded reproduction with an observed result. This host offers no OS-enforced sandbox (no Docker, no WSL, no network namespace, no read-only mount), so the Worker was never started and no concurrent request was issued. The seven leads in `NEEDS-VALIDATION.md` are all source-grounded and each one names the exact observation that would settle it.

## What would promote each lead

| Lead | Decisive observation | Where it would run |
| --- | --- | --- |
| TOTP replay protection is check-then-act and can be raced | Against a dev Worker with local D1, seed a member with a confirmed TOTP factor and a known secret. | Local harness (`@cloudflare/vitest-pool-workers`, isolated D1) |
| Concurrent recovery-code redemption can restore a consumed code | In the existing vitest-pool-workers harness (vitest.integration.config.ts:9-14, tests/integration/helpers.ts:88-99), seed user_mfa for an active member with confirmed_at = unixepoch(), a readable secret (a legacy plaintext base32 value is accepted, worker/services/mfa-secret.ts:89-90), and recovery_codes_json holding hashRecoveryCode('AAAA-AAAA') and hashRecoveryCode('BBBB-BBBB'). | Local harness (`@cloudflare/vitest-pool-workers`, isolated D1) |
| Password-reset tokens are redeemed with a non-atomic check-then-act | As a local super_admin, call POST /api/v1/users/<member>/reset-password and keep data.token from the response, because password_reset_tokens stores only token_hash and email_outbox stores no body. | Local harness (`@cloudflare/vitest-pool-workers`, isolated D1) |
| Daily effort cap is enforced with a non-atomic sum check | With a local member assigned to a task, fire two concurrent POST /api/v1/tasks/<task>/worklogs calls with 13 hours each on the same date, then sum the rows for that member and date.. | Local harness (`@cloudflare/vitest-pool-workers`, isolated D1) |
| Attachments on an approved task can still be added or archived | Using the repository isolated local stack (wrangler.test.jsonc binds ATTACHMENTS to the local R2 simulation and the integration suite already runs the real Worker against isolated D1), pick one task assigned to a member whose required checklist items are complete and whose dependencies are approved; sign in as that member and POST /api/v1/tasks/:id/submissions with a summary and one evidence entry; sign in as a review.admin and POST the review decision with result=approved; then, as the assignee, POST /api/v1/attachments with resourceType=task, that task id and a small file, and DELETE one attachment the assignee uploaded before approval. | Local harness (`@cloudflare/vitest-pool-workers`, isolated D1) |
| Wiki search binds raw input into an unbounded, unescaped LIKE pattern | In the repository's existing vitest-pool-workers harness (vitest.integration.config.ts, real Worker plus isolated D1, no network; run with npm run test:integration), seed accounts with the tests/integration/helpers seedUsers/login/call helpers, create one wiki_pages row with visibility 'members' and current_version 1 plus the matching wiki_versions row as the member, then call GET /api/v1/workspace/wiki?search=<100-character ASCII term> as that member and expect 500 with error.code INTERNAL_ERROR. | Local harness (`@cloudflare/vitest-pool-workers`, isolated D1) |
| MFA enrollment and confirmation accept the session without the current password | Add one test in tests/integration/ using the existing @cloudflare/vitest-pool-workers harness (real Worker, isolated D1, no network), modelled on tests/integration/phase3-security.test.ts:126-154: sign in as a member whose user_mfa row is absent; POST /api/v1/account/mfa/setup with body {} and assert 200 with a secret; POST /api/v1/account/mfa/confirm with a code derived from that secret and assert 200 with ten recovery codes; assert a second setup returns 409 MFA_ALREADY_ENABLED; assert /api/v1/account/mfa/disable with the correct password and an unrelated six-digit code returns 401 MFA_CODE_INVALID and leaves the row present; insert a password_reset_tokens row directly, complete /api/v1/auth/reset-password, and assert the following /api/v1/auth/login returns mfaRequired true; then call /api/v1/users/:id/mfa/reset as a second admin and assert the target user_mfa row is gone and password login succeeds.. | Local harness (`@cloudflare/vitest-pool-workers`, isolated D1) |

## Remediation shape, per lead (no code applied)

### TOTP replay protection is check-then-act and can be raced

Make the step write a compare-and-swap (`WHERE user_id = ? AND (last_used_step IS NULL OR last_used_step < ?)`) and refuse to create a session when the challenge-consumption update reports zero changes.

### Concurrent recovery-code redemption can restore a consumed code

Delete the matched hash with a conditional statement instead of writing the whole array back, or store one row per recovery code and delete by id with an affected-row check.

### Password-reset tokens are redeemed with a non-atomic check-then-act

Claim the token first with `UPDATE password_reset_tokens SET used_at = unixepoch() WHERE id = ? AND used_at IS NULL` and abort when zero rows change, before hashing the new password.

### Daily effort cap is enforced with a non-atomic sum check

Move the cap into the write: an `INSERT ... SELECT` carrying the daily-total predicate, plus a unique per-user-per-day guard, and reject a zero change count.

### Attachments on an approved task can still be added or archived

Add a status predicate to the task branch of `canAttach` and to the archive path, or add an explicit reopen transition that the review record can see.

### Wiki search binds raw input into an unbounded, unescaped LIKE pattern

Reuse `buildLikePatterns` from `worker/services/search.ts` in the wiki handler, and apply the same sweep to `tasks.ts:167`, `admin.ts:74`, and the missing byte budget in `hardware.ts:59`.

### MFA enrollment and confirmation accept the session without the current password

Require the current password on `POST /mfa/setup` and `POST /mfa/confirm`, matching `/mfa/disable` and `/mfa/recovery-codes`, if the owner decides enrollment is a privileged factor change.

## Regression cases worth writing first

- Two concurrent `/auth/login/mfa` calls with one challenge token and one code must yield exactly one `200`.
- A consumed recovery code must stay consumed after any concurrent login pair.
- A reset token redeemed twice must yield one success and one `RESET_TOKEN_INVALID`.
- Two concurrent worklog posts of 13 hours must not both succeed.
- Upload and archive against an approved task must be rejected once the freeze rule is decided.
- A 100-character wiki search term must return `200` after the escape-and-budget fix.
