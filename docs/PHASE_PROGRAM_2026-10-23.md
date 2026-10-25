# CERBERUS Workspace — Ten-Feature Program (2026-10-23)

Baseline: `main` at `ec769bb`, clean tree, typecheck green, 72 unit tests, 76 D1-backed integration tests.
Production remains on Worker `a775154e-6d0a-4a98-b571-a0035aefa3a0`; this program does not deploy, push, or apply remote migrations.

## Phase 0 — execution plan

Phase boundaries are hard stops. Each phase ends with the full gate:

```powershell
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run build
npm run test:e2e
```

No later phase starts unless the previous gate is green or every failure is documented as pre-existing.

## Phase 1 — quick wins and data visibility

| Feature | Vertical slice | Main files |
|---|---|---|
| Safe documentation workspace | GFM renderer, strict URL policy, raw HTML disabled, wiki render + live editor preview, assistant replies | `src/components/markdown.tsx`, `src/features/workspace/wiki-page.tsx`, `src/features/assistant/assistant-page.tsx` |
| Experiment run explorer | `GET /workspace/experiments/:id/runs`, metric validation, safe run numbering, history/detail/comparison UI, recharts trend, CSV export, optional task/checkpoint link | `db/migrations/0008_*.sql`, `worker/routes/experiments.ts`, `src/features/workspace/experiment-runs-panel.tsx` |
| Hardware lifecycle | Return with condition, item/member custody history, maintenance/calibration log, low-stock state, explicit quantity vs serialized tracking mode | `worker/routes/hardware.ts`, `src/features/workspace/hardware-detail-panel.tsx` |
| Notification Center MVP | Unread count + sidebar badge, atomic read-all, filter/pagination, server-resolved deep links, realtime invalidation | `worker/routes/notifications.ts`, `src/features/collaboration/notifications-page.tsx`, `src/components/app-shell.tsx` |
| Global search MVP | `GET /search` over tasks/wiki/decisions with server ACL, Ctrl/Cmd+K palette, recent items, quick actions, keyboard navigation | `worker/routes/search.ts`, `worker/services/search.ts`, `src/components/command-palette.tsx` |

New migration `0008` only; `0001`–`0007` are frozen. It adds hardware tracking mode/minimum quantity, return-condition metadata, the maintenance log, experiment run task/checkpoint links, and a notification-to-realtime-event trigger.

Verification adds:

- unit tests for Markdown XSS rejection, experiment metric bounds, and palette helpers;
- D1 integration tests for search ACLs, notification read-all/links, experiment runs, and the hardware return/maintenance lifecycle;
- E2E coverage for wiki rendering + preview and the command palette.

Provider-gated behavior (R2, email, GitHub) is untouched in this phase. No live-success claim will be made.

### Phase 1 — completion record (2026-10-24)

**Status: implemented and verified locally; not deployed.**

- Migration `0008_phase1_workspace.sql` applied to local D1 only. Remote D1 remains at `0001`–`0007`; production Worker remains `a775154e-6d0a-4a98-b571-a0035aefa3a0`.
- Safe documentation: `src/components/markdown.tsx` renders GFM through `react-markdown` + `remark-gfm` with `skipHtml`, no raw-HTML pipeline, and a URL policy restricted to `http`/`https`/`mailto` plus relative links. The wiki page renders Markdown, syncs the selected slug into the URL, and offers an editor preview; assistant replies render as Markdown.
- Experiment runs: `worker/routes/experiments.ts` serves list/create/detail plus CSV export, validates metrics, and allocates `run_number` through an atomic batch guarded by the unique `(experiment_id, run_number)` index. The UI exposes history, detail, comparison, trend chart, CSV, and optional task/checkpoint links.
- Hardware lifecycle: `worker/routes/hardware.ts` supports `quantity` and `serialized` tracking modes, admin-only checkout/maintenance, holder-or-admin return with a required condition, custody history, maintenance/calibration log, and server-computed low stock plus overdue maintenance. Serialized items are constrained to quantity 1 by schema guards.
- Notification Center: paginated listing plus meta, atomic read-all, unread count for the sidebar badge, server-resolved deep links (review links only for `review.admin`), and a `notifications_workspace_event` trigger that publishes `workspace_events` rows for realtime invalidation. Polling remains the fallback.
- Global search: `worker/services/search.ts` and `worker/routes/search.ts` query tasks, wiki pages, and decisions with server-side ACL filtering, 2–100 character queries, and a limit capped at 10. The palette supports Ctrl/Cmd+K, recent items, quick actions, and keyboard navigation.
- Test evidence: typecheck, lint, `npm test` (85 tests / 15 files), `npm run test:integration` (80 tests / 13 files), production build, and `npm run test:e2e` (8 tests, Edge channel). `npm audit --omit=dev` reports 0 vulnerabilities; the full audit keeps 10 dev-tooling findings (4 moderate, 6 high).
- No live-success claim is made for R2, email, or GitHub. Those provider gates are unchanged.

## Phase 2 — planning and governance

Task dates/estimates/worklogs, My Week, overdue, calendar, workload, dependency Gantt; review rubrics and reviewer assignment; notification preferences and digests; GitHub PR/CI state and merge readiness.

### Phase 2 — completion record (2026-10-25)

**Status: implemented and verified locally; not deployed.**

- Migration `0009_phase2_planning_governance.sql` applied to local D1 only (29 statements). Remote D1 remains at `0001`–`0007`; production Worker remains `a775154e-6d0a-4a98-b571-a0035aefa3a0`.
- Task scheduling and effort: `start_date`, `due_date`, and `estimate_hours` are validated on create and update (`INVALID_SCHEDULE`), surfaced in list/detail payloads, and stored as UTC date keys. `task_worklogs` enforces owner-or-admin access, 0.25–24 hour entries, a today+1 UTC date ceiling (`FUTURE_WORKLOG`), and a 24-hour per-user per-day cap across tasks (`DAILY_HOURS_EXCEEDED`); additions and deletions are audited. The task detail page gains a schedule summary and an effort ledger.
- Planning surface: `worker/routes/planning.ts` mounts `/api/v1/planning` with `my-week`, `calendar`, `timeline`, and `workload`. Members read their own plan; administrators, technical leads, and supervisors may pass `memberId`; supervisors are read-only. Windows are capped at 180 days, list endpoints return pagination meta, and timeline dependency edges ride in `meta.edges` so `apiWithMeta` consumes them in one request. The UI consolidates My Week, Calendar, Timeline, and Workload into `/planning` with WAI-ARIA tabs, roving tabindex, and arrow/Home/End navigation.
- Review governance: rubrics require 2–12 weighted criteria with unique labels summing to 100 and support deactivation. Assignments store reviewer and optional rubric and notify the reviewer. Self-review is rejected (`SELF_REVIEW_FORBIDDEN`); the assigned reviewer alone may decide, with a super-admin override. Scored decisions store `scores_json` and `total_score`; rubric mismatch, missing scores, and scores without a rubric are rejected. Unscored decisions stay valid when no rubric is assigned.
- Notification delivery: category preferences (`task`, `review`, `collaboration`, `account`, `digest`) with in-app and email channels are enforced as read-time SQL filters, leaving existing insert sites untouched. Digest frequency is stored per user; digests are created idempotently per period through `INSERT ... WHERE NOT EXISTS`, exposed as a manual endpoint, and generated by the scheduled cron. Email stays provider-gated: without a transport, digests record `skipped` and no live delivery is claimed.
- GitHub PR/CI state: the webhook persists open/closed/merged pull requests with draft flag, head/base refs, head SHA, and merge timestamp; `check_suite`, `check_run`, and `status` events set `checks_status`. `/pull-requests` is paginated with a state filter, and sync enriches up to 10 open pull requests through a separate `fetchChecksRollup` so the existing three-call `syncRepository` contract is unchanged.
- Deliberate deviation from the Phase 0 sketch: a merge does **not** set the task to `ready_for_review`. It records PR state and sends `task.github_merged` to linked assignees so they can submit evidence through the existing gate. The evidence-required transition (`SUBMISSION_REQUIRED`) remains intact.
- Test evidence: typecheck, lint, `npm test` (99 tests / 16 files), `npm run test:integration` (92 tests / 14 files), production build, and `npm run test:e2e` (10 tests, Edge channel). New suites are `tests/unit/phase2-planning.test.ts`, `tests/integration/phase2-planning.test.ts`, and `tests/e2e/planning.spec.ts`. `npm audit --omit=dev` reports 0 vulnerabilities.
- No live-success claim is made for R2, email, or GitHub outbound. Those provider gates are unchanged.

## Phase 3 — differentiators and hardening (not started)

Persistent assistant threads, retrieval-backed citations, audited read-only tools; account/security center with sessions, login history, TOTP MFA, idle timeout.

## Status log

- 2026-10-23: baseline verified; Phase 1 started.
- 2026-10-24: Phase 1 gate green locally (85 unit / 15 files, 80 integration / 13 files, 8 E2E) and committed. No push, deploy, or remote migration. Phase 2 not started.
- 2026-10-25: Phase 2 gate green locally (99 unit / 16 files, 92 integration / 14 files, 10 E2E) and ready to commit. Migration `0009` local-only; no push, deploy, or remote mutation. Phase 3 not started.
