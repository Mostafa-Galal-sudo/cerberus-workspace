import { beforeEach, describe, expect, it } from 'vitest';
import {
  filterTourSteps,
  ONBOARDING_STORAGE_KEY,
  onboardingStatus,
  roleRecap,
  TOUR_STEPS,
  writeOnboardingMarker,
  type TourContext,
} from '../../src/lib/onboarding';

describe('onboarding state helpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('treats missing, malformed, or empty storage as pending', () => {
    expect(onboardingStatus(null, 'u1')).toBe('pending');
    expect(onboardingStatus('', 'u1')).toBe('pending');
    expect(onboardingStatus('{broken', 'u1')).toBe('pending');
    expect(onboardingStatus('[]', 'u1')).toBe('pending');
    expect(onboardingStatus('42', 'u1')).toBe('pending');
  });

  it('reports completed and dismissed per user', () => {
    const raw = JSON.stringify({
      u1: { completedAt: 100 },
      u2: { dismissedAt: 200 },
    });
    expect(onboardingStatus(raw, 'u1')).toBe('completed');
    expect(onboardingStatus(raw, 'u2')).toBe('dismissed');
    expect(onboardingStatus(raw, 'u3')).toBe('pending');
  });

  it('supports the wildcard marker used by automated tests', () => {
    expect(onboardingStatus(JSON.stringify({ '*': { completedAt: 1 } }), 'anyone')).toBe('completed');
    // Real user entries take precedence over the wildcard.
    const raw = JSON.stringify({ '*': { completedAt: 1 }, u9: { dismissedAt: 2 } });
    expect(onboardingStatus(raw, 'u9')).toBe('dismissed');
  });

  it('writes and re-reads markers through localStorage', () => {
    expect(onboardingStatus(localStorage.getItem(ONBOARDING_STORAGE_KEY), 'u1')).toBe('pending');
    writeOnboardingMarker('u1', 'completed');
    expect(onboardingStatus(localStorage.getItem(ONBOARDING_STORAGE_KEY), 'u1')).toBe('completed');
    writeOnboardingMarker('u1', 'dismissed');
    expect(onboardingStatus(localStorage.getItem(ONBOARDING_STORAGE_KEY), 'u1')).toBe('dismissed');
  });
});

describe('tour step filtering', () => {
  const member: TourContext = { mode: 'member', roles: ['team_member'] };
  const admin: TourContext = { mode: 'admin', roles: ['super_admin', 'team_member'] };
  const supervisor: TourContext = { mode: 'supervisor', roles: ['project_supervisor'] };

  it('every step has a unique id and non-empty title', () => {
    const ids = TOUR_STEPS.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const step of TOUR_STEPS) {
      expect(step.title.length).toBeGreaterThan(0);
      if (step.id !== 'finish') {
        expect(step.body.length).toBeGreaterThan(0);
      }
    }
  });

  it('hides admin-only steps from members and supervisors', () => {
    const memberIds = filterTourSteps(TOUR_STEPS, member).map((step) => step.id);
    const supervisorIds = filterTourSteps(TOUR_STEPS, supervisor).map((step) => step.id);
    expect(memberIds).not.toContain('reviews');
    expect(memberIds).not.toContain('command-center');
    expect(supervisorIds).not.toContain('reviews');
    expect(supervisorIds).not.toContain('command-center');
    expect(memberIds).toContain('dashboard');
    expect(memberIds).toContain('finish');
  });

  it('keeps admin steps for admins', () => {
    const adminIds = filterTourSteps(TOUR_STEPS, admin).map((step) => step.id);
    expect(adminIds).toContain('reviews');
    expect(adminIds).toContain('command-center');
  });
});

describe('role recap', () => {
  it('describes each mode distinctly', () => {
    expect(roleRecap({ mode: 'admin', roles: [] })).toMatch(/review queue/i);
    expect(roleRecap({ mode: 'supervisor', roles: [] })).toMatch(/read-only/i);
    expect(roleRecap({ mode: 'member', roles: [] })).toMatch(/submit/i);
  });
});
