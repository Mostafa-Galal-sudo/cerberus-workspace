// Learning Guide onboarding state + tour step definitions.
// Pure logic lives here so it can be unit-tested without a DOM.

export const ONBOARDING_STORAGE_KEY = 'cerberus.onboarding.v1';

export type OnboardingMarker = 'completed' | 'dismissed';

export interface OnboardingEntry {
  completedAt?: number;
  dismissedAt?: number;
}

export type OnboardingState = Record<string, OnboardingEntry>;

export function readOnboardingState(raw: string | null | undefined): OnboardingState {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const entries: OnboardingState = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const entry = value as Record<string, unknown>;
      const clean: OnboardingEntry = {};
      if (typeof entry.completedAt === 'number') clean.completedAt = entry.completedAt;
      if (typeof entry.dismissedAt === 'number') clean.dismissedAt = entry.dismissedAt;
      if (clean.completedAt !== undefined || clean.dismissedAt !== undefined) entries[key] = clean;
    }
    return entries;
  } catch {
    return {};
  }
}

export type OnboardingStatus = 'pending' | 'completed' | 'dismissed';

export function onboardingStatus(raw: string | null | undefined, userId: string): OnboardingStatus {
  const state = readOnboardingState(raw);
  // '*' is a wildcard entry (used by automated tests) that applies to every user.
  const entry = state[userId] ?? state['*'];
  if (!entry) return 'pending';
  if (entry.completedAt) return 'completed';
  if (entry.dismissedAt) return 'dismissed';
  return 'pending';
}

export function writeOnboardingMarker(userId: string, marker: OnboardingMarker): string {
  const state = readOnboardingState(safeGet(ONBOARDING_STORAGE_KEY));
  state[userId] = marker === 'completed' ? { completedAt: Date.now() } : { dismissedAt: Date.now() };
  const serialized = JSON.stringify(state);
  safeSet(ONBOARDING_STORAGE_KEY, serialized);
  return serialized;
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private-mode browsers reject writes; onboarding simply repeats next visit.
  }
}

export interface TourContext {
  mode: 'member' | 'admin' | 'supervisor';
  roles: string[];
}

export interface TourStep {
  id: string;
  title: string;
  body: string;
  /** Route to navigate to before looking for the target. */
  route?: string;
  /** CSS selector of the element to highlight; omit for centered welcome/finish cards. */
  selector?: string;
  /** Preferred popover placement relative to the highlight box. */
  align?: 'top' | 'bottom' | 'left' | 'right';
  /** Extra wait budget for data-driven targets (default 1500 ms). */
  waitMillis?: number;
  /** Role gate — steps that the current user may not see are filtered out. */
  when?: (context: TourContext) => boolean;
}

const headerSelector = '.page-header h1';
const adminOnly = (context: TourContext) => context.mode === 'admin';

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to CERBERUS',
    body:
      'CERBERUS is the engineering sentinel workspace for the graduation project: six disciplines build one autonomous IoT defense platform, and progress only counts when it is backed by verifiable evidence. This short guide walks you through the workspace once.',
  },
  {
    id: 'navigation',
    title: 'Navigate the workspace',
    body:
      'The icon rail keeps the six primary areas one click away — Overview, Tasks, Planning, Review queue, Roster and the Team stream. Hover the rail to expand it; "More" opens the engineering modules (Wiki, Hardware, Experiments, Worklogs and friends).',
    selector: '.sidebar-nav',
    align: 'right',
  },
  {
    id: 'search',
    title: 'Find anything instantly',
    body:
      'Press Ctrl+K anywhere (or click Search) to open the command palette: quick actions plus server-side search across tasks, PRs and decisions.',
    selector: '.utility-search',
    align: 'right',
  },
  {
    id: 'alerts',
    title: 'Stay in the loop',
    body:
      'The bell collects review requests, approvals, digests and sign-in alerts. The badge shows unread items; the security screen lists your active sessions and login history.',
    selector: '.sidebar-utility a[href="/notifications"]',
    align: 'right',
  },
  {
    id: 'dashboard',
    title: 'Your dashboard',
    body:
      'The overview condenses the whole project: discipline progress, open blockers, the latest activity and your personal assignments. Admin view adds workspace-wide telemetry.',
    route: '/',
    selector: headerSelector,
  },
  {
    id: 'tasks',
    title: 'Task register & statuses',
    body:
      'Tasks flow left to right on the board: Backlog → In Progress → Ready for Review → Approved. Cards can be dragged between columns where your role allows it; the List view groups everything by discipline, and "Milestones" shows the weekly checkpoints.',
    route: '/tasks',
    selector: '.task-toolbar',
    align: 'bottom',
  },
  {
    id: 'checkpoints',
    title: 'Checkpoints & evidence',
    body:
      'Each checkpoint defines a required deliverable and acceptance criteria. Work happens inside linked tasks; when every task is approved, the checkpoint owner submits the deliverable plus evidence (links or files) for review. The thin bar tracks approved-task progress.',
    route: '/tasks?view=checkpoints',
    selector: '.checkpoint-overview-card',
    waitMillis: 2500,
  },
  {
    id: 'planning',
    title: 'Planning & capacity',
    body:
      'My Week, the calendar, the dependency Gantt and the workload view answer one question: what is due, for whom, and can it fit. Effort is logged as worklogs with a daily cap.',
    route: '/planning',
    selector: headerSelector,
  },
  {
    id: 'engineering',
    title: 'Engineering evidence modules',
    body:
      'The "More" menu holds the laboratory record: the documentation wiki (safe GFM), hardware custody and maintenance, experiment runs with metrics, architecture decision records, daily worklogs, defect & blocker tracking, and GitHub PR/CI status.',
    route: '/wiki',
    selector: headerSelector,
  },
  {
    id: 'roster',
    title: 'Roster & responsibilities',
    body:
      'Members shows each engineer\'s specialization, live roadmap progress and supervisor feedback. Roles decide what each account can do — regular members work tasks and submit evidence, technical leads own checkpoints.',
    route: '/members',
    selector: headerSelector,
  },
  {
    id: 'assistant',
    title: 'Sentinel AI & reports',
    body:
      'The assistant answers workspace questions using read-only server tools with citations (it never executes commands). Server-rendered PDF reports under Reports summarise progress for the supervisor.',
    route: '/assistant',
    selector: headerSelector,
  },
  {
    id: 'reviews',
    title: 'Review queue (admin)',
    body:
      'Administrators review submitted checkpoints here: assign a reviewer, score against the weighted rubric, then approve or request changes. Members never see this queue.',
    route: '/reviews',
    selector: headerSelector,
    when: adminOnly,
  },
  {
    id: 'command-center',
    title: 'Command center (admin)',
    body:
      'The command center is the administrative core: workspace settings, the audit log trail, and verified backup export/restore.',
    route: '/admin',
    selector: headerSelector,
    when: adminOnly,
  },
  {
    id: 'finish',
    title: 'You are ready',
    body: '', // filled at render time from the role recap
  },
];

export function filterTourSteps(steps: TourStep[], context: TourContext): TourStep[] {
  return steps.filter((step) => !step.when || step.when(context));
}

export function roleRecap(context: TourContext): string {
  if (context.mode === 'admin') {
    return 'As an administrator you own the full cycle: manage members and tasks, submit checkpoint evidence, and review or approve submissions from the review queue.';
  }
  if (context.mode === 'supervisor') {
    return 'As a supervisor you have a read-only view: follow progress, read evidence and leave feedback — the workspace blocks administrative actions by design.';
  }
  return 'As a member you work your assigned tasks, log effort, and submit deliverables with evidence when your checkpoint is complete. Reviews are handled by administrators.';
}
