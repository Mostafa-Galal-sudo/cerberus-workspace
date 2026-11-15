# Weekly checkpoint plan — applied 2026-11-15

The roadmap in production was rebuilt from `docs/WEEKLY_CHECKPOINTS_TASKS_2026-11-15.md`
(the owner's six-week plan, 16 Nov – 27 Dec 2026). The previous structure — 30 domain
checkpoints, 30 linked tasks, 24 dependencies, and 120 placeholder checklist items — was
removed. No submission, review, comment, worklog, or attachment existed at the time, so no
work history was lost.

## What exists now

| Item | Count | Notes |
|---|---|---|
| Milestones | 6 | `milestone_c1` … `milestone_c6`, one per week, `domain_id` NULL because a week spans domains |
| Checkpoints | 6 | `checkpoint_c1` … `checkpoint_c6`, one per week, owner `user_mostafa` (submits the weekly review) |
| Tasks | 57 | 53 linked to a checkpoint + 4 cross-checkpoint tasks |
| `checkpoint_tasks` | 53 | all `mandatory = 1` |
| `task_dependencies` | 61 | mapped from the plan's "Depends on" column |

### Checkpoints and their gates

| Checkpoint | Window | Tasks |
|---|---|---|
| `checkpoint_c1` Foundation & Data Pipeline | 2026-11-16 → 2026-11-22 | 10 |
| `checkpoint_c2` Detection Engine v1 + First Benchmark | 2026-11-23 → 2026-11-29 | 9 |
| `checkpoint_c3` Agents + Response + Dashboard, End-to-End on Simulated | 2026-11-30 → 2026-12-06 | 10 |
| `checkpoint_c4` Real Testbed Online, Lab Dataset v1 | 2026-12-07 → 2026-12-13 | 9 |
| `checkpoint_c5` Closed Loop on Real Testbed + Evaluation Report | 2026-12-14 → 2026-12-20 | 7 |
| `checkpoint_c6` RF Resilience (Stretch) + Final Deliverables | 2026-12-21 → 2026-12-27 | 8 |

### Cross-checkpoint tasks

`WK-T01` … `WK-T04` (push with a tag, update `docs/PROGRESS.md`, weekly evidence pack, full
suite + lint) are tasks `task_wk_t01` … `task_wk_t04`. They are **not** linked to any
checkpoint on purpose: the submission gate counts every linked task whose status is not
`approved`, so linking them would block each weekly submission until they were approved
again.

## Ownership

Every task is assigned to `user_mostafa` and the owner redistributes them from the member
dialog. `domain_id` still records the engineering area of the work (embedded, AI, network,
wireless, backend, frontend) so the domain filter and the workload view stay meaningful
after redistribution.

| Area | Tasks |
|---|---|
| Embedded / integration (`domain_1`) | 18 |
| AI / detection (`domain_2`) | 15 |
| Backend / data (`domain_5`) | 8 |
| Wireless / RF (`domain_4`) | 7 |
| Networking (`domain_3`) | 6 |
| Frontend / dashboard (`domain_6`) | 3 |

## Task fields

- `title` and `description` come from the plan's Task column; `description` also carries
  the expected output and the dependency list.
- `expected_outputs` and `deliverables` come from the plan's Output column.
- `prerequisites` states the dependency chain.
- `start_date` / `due_date` are the first and last day of the checkpoint week, so overdue
  work is visible in Planning & capacity.
- `priority` is `high` on the plan's critical path (`C1-T05`, `C2-T07`, `C3-T08`, `C5-T01`)
  and on the final report and deck; `low` on the RF stretch tasks; `medium` elsewhere.
- `acceptance_criteria`, `validation_procedure`, and `evidence_requirements` stay empty at
  task level; the plan states acceptance once per checkpoint, and it is stored on the
  checkpoint record.
- No checklist items were created: the plan does not define per-task steps, and the old
  generic four-step checklist was placeholder text.

## Visibility and attribution

Two changes ship with the plan so the whole team can see progress:

1. **Team toggle** on Task register (`src/features/tasks/tasks-page.tsx`). A member's board
   used to be filtered to their own tasks (`mine=true`); the toggle switches to every
   member's tasks. The API never restricted this — `GET /api/v1/tasks` has no owner gate.
2. **"Who did what"** on every checkpoint card. It expands a table of the checkpoint's tasks
   with assignee, status, checklist progress, logged hours, and due date, plus a per-assignee
   summary (approved / in progress / not started / hours) and an `overdue` marker. The data
   comes from `GET /api/v1/tasks/checkpoints/:id`, which now also returns
   `checklistTotal`, `checklistDone`, `loggedHours`, `worklogCount`, `startDate`, `dueDate`,
   and `updatedAt` per task.

## Verification

Applied with `wrangler d1 execute --remote` on 2026-11-15 (448 changes), then read back:

```
milestones 6 · checkpoints 6 · tasks 57 · checkpoint_tasks 53 · task_dependencies 61
distinct assignees 1 (user_mostafa) · checklist items 0
per checkpoint: 10 / 9 / 10 / 9 / 7 / 8 tasks, dates matching each week
```

Local gate after the UI change: `typecheck`, `lint`, 126 unit tests, 104 D1 integration
tests, production build. The checkpoints view was exercised against the local stack: the six
cards render with the weekly titles and the ownership table opens with 10 rows for `c1`.

## Rollback

A full export was taken before the change:
`%TEMP%\opencode\d1-backup-before-plan-2026-11-15.sql`. The local companion
`%TEMP%\opencode\plan-rollback.sql` deletes the weekly plan rows; restoring the previous
roadmap means importing that export.

## Redistributing

The owner distributes work as administrator: Engineering roster → member → Reassign work
(checkpoint + its tasks together), or `PATCH /api/v1/tasks/:id` with a new `assigneeId`.
Checkpoint owners can also be changed with the same administrative path.
