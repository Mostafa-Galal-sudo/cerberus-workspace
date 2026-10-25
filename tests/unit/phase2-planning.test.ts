import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addDaysDateOnly,
  dateOnlyToEpoch,
  dateOnlySchema,
  epochToDateOnly,
  todayDateOnly,
  weekStartDateOnly,
} from '../../shared/schemas/dates';
import {
  notificationPreferencesSchema,
  reviewRubricSchema,
  taskSchedulePatchSchema,
  taskWorklogSchema,
} from '../../shared/schemas/planning';
import { reviewDecisionSchema } from '../../shared/schemas/tasks';
import { fetchChecksRollup } from '../../worker/services/github';
import type { Env } from '../../worker/types';

const githubEnv = { GITHUB_TOKEN: 'ghp_checks_test_token' } as unknown as Env;

function stubChecks(payload: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('calendar-date helpers', () => {
  it('only accepts real UTC calendar dates', () => {
    expect(dateOnlySchema.safeParse('2026-02-28').success).toBe(true);
    expect(dateOnlySchema.safeParse('2026-02-30').success).toBe(false);
    expect(dateOnlySchema.safeParse('2026-13-01').success).toBe(false);
    expect(dateOnlySchema.safeParse('2026-1-01').success).toBe(false);
    expect(dateOnlySchema.safeParse('28-02-2026').success).toBe(false);
  });

  it('round-trips epochs and date keys at UTC midnight', () => {
    expect(epochToDateOnly(dateOnlyToEpoch('2026-03-01'))).toBe('2026-03-01');
    expect(dateOnlyToEpoch('1970-01-01')).toBe(0);
  });

  it('anchors weeks on Monday and tolerates Sundays', () => {
    expect(weekStartDateOnly('2026-10-24')).toBe('2026-10-19');
    expect(weekStartDateOnly('2026-10-19')).toBe('2026-10-19');
    expect(weekStartDateOnly('2026-10-25')).toBe('2026-10-19');
    expect(weekStartDateOnly('2026-11-01')).toBe('2026-10-26');
  });

  it('adds days across month and year boundaries', () => {
    expect(addDaysDateOnly('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDaysDateOnly('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDaysDateOnly('2026-02-27', 2)).toBe('2026-03-01');
  });

  it('derives today from the injected clock in UTC', () => {
    expect(todayDateOnly(new Date('2026-10-24T23:30:00Z'))).toBe('2026-10-24');
    expect(todayDateOnly(new Date('2026-10-24T01:00:00Z'))).toBe('2026-10-24');
  });
});

describe('planning schemas', () => {
  it('accepts quarter-hour effort and rejects impossible days', () => {
    expect(taskWorklogSchema.safeParse({ workedOn: '2026-10-24', hours: 0.25 }).success).toBe(true);
    expect(taskWorklogSchema.safeParse({ workedOn: '2026-10-24', hours: 24 }).success).toBe(true);
    expect(taskWorklogSchema.safeParse({ workedOn: '2026-10-24', hours: 0.1 }).success).toBe(false);
    expect(taskWorklogSchema.safeParse({ workedOn: '2026-10-24', hours: 24.5 }).success).toBe(false);
    expect(taskWorklogSchema.safeParse({ workedOn: '2026-10-32', hours: 1 }).success).toBe(false);
  });

  it('validates schedule patches without requiring every field', () => {
    expect(taskSchedulePatchSchema.safeParse({ startDate: '2026-11-02', dueDate: null }).success).toBe(true);
    expect(taskSchedulePatchSchema.safeParse({ estimateHours: 12.5 }).success).toBe(true);
    expect(taskSchedulePatchSchema.safeParse({ estimateHours: -1 }).success).toBe(false);
    expect(taskSchedulePatchSchema.safeParse({ dueDate: 'next week' }).success).toBe(false);
  });

  it('requires rubric weights to sum to 100 with unique labels', () => {
    const valid = {
      name: 'Evidence rubric',
      description: 'Weighted evidence review',
      criteria: [{ label: 'Evidence quality', weight: 60 }, { label: 'Reproducibility', weight: 40 }],
    };
    expect(reviewRubricSchema.safeParse(valid).success).toBe(true);
    expect(reviewRubricSchema.safeParse({
      ...valid,
      criteria: [{ label: 'Evidence quality', weight: 60 }, { label: 'Reproducibility', weight: 30 }],
    }).success).toBe(false);
    expect(reviewRubricSchema.safeParse({
      ...valid,
      criteria: [{ label: 'Evidence quality', weight: 50 }, { label: 'evidence QUALITY', weight: 50 }],
    }).success).toBe(false);
    expect(reviewRubricSchema.safeParse({
      ...valid,
      criteria: [{ label: 'Only criterion', weight: 100 }],
    }).success).toBe(false);
  });

  it('accepts partial notification preference updates but rejects unknown categories', () => {
    const partial = notificationPreferencesSchema.safeParse({
      categories: { task: { inApp: false, email: true } },
    });
    expect(partial.success).toBe(true);
    expect(partial.success && partial.data.digestFrequency).toBe('off');

    expect(notificationPreferencesSchema.safeParse({
      categories: { unknown: { inApp: true, email: true } },
    }).success).toBe(false);
    expect(notificationPreferencesSchema.safeParse({
      categories: { review: { inApp: 'yes', email: true } },
    }).success).toBe(false);
    expect(notificationPreferencesSchema.safeParse({
      categories: {},
      digestFrequency: 'hourly',
    }).success).toBe(false);
  });
});

describe('scored review decisions', () => {
  it('keeps unscored decisions backwards compatible', () => {
    const parsed = reviewDecisionSchema.safeParse({ result: 'approved', feedback: '' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.scores).toEqual([]);
  });

  it('rejects duplicate criterion scores and short change requests', () => {
    expect(reviewDecisionSchema.safeParse({
      result: 'approved',
      feedback: '',
      scores: [
        { criterionId: 'criterion_a', points: 80 },
        { criterionId: 'criterion_a', points: 90 },
      ],
    }).success).toBe(false);
    expect(reviewDecisionSchema.safeParse({
      result: 'changes_requested',
      feedback: 'no',
    }).success).toBe(false);
    expect(reviewDecisionSchema.safeParse({
      result: 'changes_requested',
      feedback: 'Add the failing integration log and rerun the suite.',
      scores: [{ criterionId: 'criterion_a', points: 40 }],
    }).success).toBe(true);
  });
});

describe('GitHub checks rollup', () => {
  it('summarises completed successful check runs', async () => {
    const fetchMock = stubChecks({
      total_count: 2,
      check_runs: [
        { status: 'completed', conclusion: 'success' },
        { status: 'completed', conclusion: 'success' },
      ],
    });

    const rollup = await fetchChecksRollup(githubEnv, 'example/repo', 'abc1234');
    expect(rollup).toMatchObject({ status: 'success', total: 2, failing: 0, pending: 0 });
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://api.github.com/repos/example/repo/commits/abc1234/check-runs?per_page=100');
  });

  it('reports failing, pending and neutral outcomes distinctly', async () => {
    stubChecks({
      total_count: 2,
      check_runs: [
        { status: 'completed', conclusion: 'failure' },
        { status: 'completed', conclusion: 'success' },
      ],
    });
    expect((await fetchChecksRollup(githubEnv, 'example/repo', 'sha1')).status).toBe('failure');

    stubChecks({
      total_count: 1,
      check_runs: [{ status: 'in_progress', conclusion: null }],
    });
    const pending = await fetchChecksRollup(githubEnv, 'example/repo', 'sha2');
    expect(pending.status).toBe('pending');
    expect(pending.pending).toBe(1);

    stubChecks({
      total_count: 1,
      check_runs: [{ status: 'completed', conclusion: 'skipped' }],
    });
    expect((await fetchChecksRollup(githubEnv, 'example/repo', 'sha3')).status).toBe('neutral');
  });

  it('returns unknown when a commit has no check runs', async () => {
    stubChecks({ total_count: 0, check_runs: [] });
    const rollup = await fetchChecksRollup(githubEnv, 'example/repo', 'sha4');
    expect(rollup.status).toBe('unknown');
    expect(rollup.total).toBe(0);
  });
});
