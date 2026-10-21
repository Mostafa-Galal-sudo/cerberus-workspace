import { env } from 'cloudflare:test';
import type { Env } from '../../worker/types';
import app from '../../worker/index';
import { hashPassword } from '../../worker/services/security';

export const TEST_PASSWORD = 'Cerberus!Test2026';
export const CHANGED_PASSWORD = 'Cerberus!Changed2026';

export const ADMIN_ID = 'user_test_admin';
export const MEMBER_ID = 'user_test_member';
export const MEMBER_TWO_ID = 'user_test_member_two';
export const SUPERVISOR_ID = 'user_test_supervisor';
export const TEMP_ID = 'user_test_temp';
export const ADMIN_EMAIL = 'admin@cerberus.test';
export const MEMBER_EMAIL = 'member@cerberus.test';
export const MEMBER_TWO_EMAIL = 'member2@cerberus.test';
export const SUPERVISOR_EMAIL = 'supervisor@cerberus.test';
export const TEMP_EMAIL = 'temp@cerberus.test';

export const bindings = env as unknown as Env;

export interface Session {
  cookie: string;
  csrf: string;
  mustChangePassword: boolean;
}

/**
 * Seeds five accounts with deterministic IDs:
 * - super-admin, two team members, a project supervisor and a member that
 *   still has the temporary-password flag set.
 */
export async function seedUsers(): Promise<void> {
  const passwordHash = await hashPassword(TEST_PASSWORD);
  const statements: Array<ReturnType<typeof env.DB.prepare>> = [];
  const accounts: Array<[string, string, string, string, number]> = [
    [ADMIN_ID, ADMIN_EMAIL, 'Admin Sentinel', 'Technical Lead', 0],
    [MEMBER_ID, MEMBER_EMAIL, 'Member One', 'Firmware Engineering', 0],
    [MEMBER_TWO_ID, MEMBER_TWO_EMAIL, 'Member Two', 'Network Security', 0],
    [SUPERVISOR_ID, SUPERVISOR_EMAIL, 'Project Supervisor', 'Academic Supervision', 0],
    [TEMP_ID, TEMP_EMAIL, 'Temp Member', 'Backend Engineering', 1],
  ];

  for (const [id, email, displayName, specialization, mustChange] of accounts) {
    statements.push(env.DB.prepare(`INSERT INTO users (id, email, display_name, specialization, status, password_hash, must_change_password)
      VALUES (?, ?, ?, ?, 'active', ?, ?)`).bind(id, email, displayName, specialization, passwordHash, mustChange));
    statements.push(env.DB.prepare(`INSERT INTO project_members (project_id, user_id, membership_role) VALUES ('project_cerberus', ?, 'member')`).bind(id));
  }

  statements.push(env.DB.prepare(`INSERT INTO user_roles (user_id, role_id) VALUES (?, 'role_admin')`).bind(ADMIN_ID));
  statements.push(env.DB.prepare(`INSERT INTO user_roles (user_id, role_id) VALUES (?, 'role_member')`).bind(MEMBER_ID));
  statements.push(env.DB.prepare(`INSERT INTO user_roles (user_id, role_id) VALUES (?, 'role_member')`).bind(MEMBER_TWO_ID));
  statements.push(env.DB.prepare(`INSERT INTO user_roles (user_id, role_id) VALUES (?, 'role_supervisor')`).bind(SUPERVISOR_ID));
  statements.push(env.DB.prepare(`INSERT INTO user_roles (user_id, role_id) VALUES (?, 'role_member')`).bind(TEMP_ID));
  statements.push(env.DB.prepare(`INSERT INTO team_members (team_id, user_id) VALUES ('team_cerberus', ?)`).bind(ADMIN_ID));
  statements.push(env.DB.prepare(`INSERT INTO team_members (team_id, user_id) VALUES ('team_cerberus', ?)`).bind(MEMBER_ID));

  await env.DB.batch(statements);
}

export async function login(email: string, password: string = TEST_PASSWORD): Promise<Session> {
  const response = await app.request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }, bindings);

  if (response.status !== 200) {
    throw new Error(`Login failed for ${email}: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json() as { data: { csrfToken: string; mustChangePassword: boolean } };
  const cookies = response.headers.getSetCookie();
  const sessionCookie = cookies
    .map((cookie) => cookie.split(';')[0])
    .find((cookie) => cookie.startsWith('cerberus_session='));

  if (!sessionCookie) throw new Error(`Login for ${email} did not return a session cookie`);

  return {
    cookie: sessionCookie,
    csrf: payload.data.csrfToken,
    mustChangePassword: payload.data.mustChangePassword,
  };
}

/** Executes an HTTP request against the real Hono worker with a real D1 binding. */
export async function call(session: Session | null, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const method = (init.method ?? 'GET').toUpperCase();

  if (session) {
    headers.set('cookie', session.cookie);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) headers.set('x-csrf-token', session.csrf);
  }
  if (init.body !== undefined && !(init.body instanceof FormData) && !headers.has('content-type')) headers.set('content-type', 'application/json');

  return app.request(path, { ...init, headers }, bindings);
}

export interface ApiBody<T> {
  ok: boolean;
  data: T;
  error?: { code: string; message: string; fields?: unknown };
  meta?: Record<string, unknown>;
}

export async function readBody<T>(response: Response): Promise<ApiBody<T>> {
  return response.json() as Promise<ApiBody<T>>;
}

export async function readData<T>(response: Response): Promise<T> {
  const payload = await readBody<T>(response);
  if (!payload.ok) throw new Error(`Expected success but received ${JSON.stringify(payload.error)}`);
  return payload.data;
}

export async function createTask(admin: Session, input: {
  assigneeId: string;
  title: string;
  checkpointId?: string;
  dependencyIds?: string[];
  priority?: string;
}): Promise<string> {
  const response = await call(admin, '/api/v1/tasks', {
    method: 'POST',
    body: JSON.stringify({
      projectId: 'project_cerberus',
      assigneeId: input.assigneeId,
      checkpointId: input.checkpointId,
      title: input.title,
      description: `Integration-test task description for ${input.title}.`,
      acceptanceCriteria: 'The acceptance criteria are verified by an automated integration test.',
      validationProcedure: 'Run the integration suite and inspect the persisted D1 evidence.',
      evidenceRequirements: 'A reproducible command output and a commit reference.',
      priority: input.priority ?? 'high',
    }),
  });
  const data = await readData<{ id: string }>(response);

  for (const dependencyId of input.dependencyIds ?? []) {
    const dependency = await call(admin, `/api/v1/tasks/${data.id}/dependencies`, {
      method: 'POST',
      body: JSON.stringify({ dependsOnTaskId: dependencyId }),
    });
    if (dependency.status !== 201) throw new Error(`Failed to add dependency: ${dependency.status}`);
  }

  return data.id;
}

export async function completeChecklist(session: Session, taskId: string): Promise<void> {
  const detail = await readData<{ checklist: Array<{ id: string }> }>(await call(session, `/api/v1/tasks/${taskId}`));
  for (const item of detail.checklist) {
    const response = await call(session, `/api/v1/tasks/${taskId}/checklist/${item.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ completed: true }),
    });
    if (response.status !== 200) throw new Error(`Checklist update failed: ${response.status} ${await response.text()}`);
  }
}

export function taskSubmission(evidenceCount = 2) {
  const evidence = [
    { kind: 'github', label: 'Implementation commit', value: 'https://github.com/Mostafa-Galal-sudo/cerberus-workspace/commit/abc1234' },
    { kind: 'note', label: 'Local verification log', value: 'vitest run tests/integration -> 1 suite passed' },
    { kind: 'url', label: 'Reproduction run', value: 'https://example.test/runs/42' },
  ];
  return {
    summary: 'Implemented the required behaviour and verified it with automated integration coverage and reproducible command output.',
    evidence: evidence.slice(0, evidenceCount),
  };
}

export function checkpointSubmission(evidenceCount = 2) {
  return {
    summary: 'Checkpoint deliverables are complete: every mandatory task is approved and the evidence package was re-executed end to end.',
    evidence: [
      { kind: 'github', label: 'Checkpoint commit', value: 'https://github.com/Mostafa-Galal-sudo/cerberus-workspace/commit/def5678' },
      { kind: 'note', label: 'Acceptance verification', value: 'All mandatory checkpoint criteria verified in the isolated lab.' },
    ].slice(0, evidenceCount),
  };
}

export async function reviewSubmission(admin: Session, submissionId: string, result: 'approved' | 'changes_requested', feedback = '') {
  return call(admin, `/api/v1/reviews/${submissionId}`, {
    method: 'POST',
    body: JSON.stringify({ result, feedback }),
  });
}

export async function seedDomainAndMilestone(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO engineering_domains (id, project_id, name, sort_order) VALUES ('domain_test', 'project_cerberus', 'Integration Test Domain', 99)`),
    env.DB.prepare(`INSERT OR IGNORE INTO milestones (id, project_id, domain_id, title, sort_order) VALUES ('milestone_test', 'project_cerberus', 'domain_test', 'Integration Test Milestone', 99)`),
  ]);
}

export interface CheckpointFixture {
  id: string;
  ownerId: string;
  title: string;
  status?: string;
  tasks: Array<{ id: string; status: string; assigneeId?: string }>;
}

export async function seedCheckpoint(fixture: CheckpointFixture): Promise<void> {
  await seedDomainAndMilestone();
  const statements: Array<ReturnType<typeof env.DB.prepare>> = [
    env.DB.prepare(`INSERT INTO checkpoints (id, milestone_id, owner_id, title, status) VALUES (?, 'milestone_test', ?, ?, ?)`)
      .bind(fixture.id, fixture.ownerId, fixture.title, fixture.status ?? 'in_progress'),
  ];

  for (const task of fixture.tasks) {
    statements.push(env.DB.prepare(`INSERT INTO tasks (id, project_id, domain_id, assignee_id, created_by, title, status,
        acceptance_criteria, validation_procedure, evidence_requirements)
      VALUES (?, 'project_cerberus', 'domain_test', ?, ?, ?, ?, 'Acceptance criteria for the checkpoint fixture task.',
        'Validation procedure for the checkpoint fixture task.', 'Evidence requirements for the checkpoint fixture task.')`)
      .bind(task.id, task.assigneeId ?? fixture.ownerId, ADMIN_ID, `Fixture task ${task.id}`, task.status));
    statements.push(env.DB.prepare(`INSERT INTO checkpoint_tasks (checkpoint_id, task_id) VALUES (?, ?)`).bind(fixture.id, task.id));
  }

  await env.DB.batch(statements);
}

export async function databaseValue<T>(query: string, ...values: unknown[]): Promise<T | null> {
  return env.DB.prepare(query).bind(...values).first<T>();
}
