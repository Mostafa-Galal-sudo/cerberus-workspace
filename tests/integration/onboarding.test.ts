import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { call, login, readBody, readData } from './helpers';

describe('first-run workspace initialization', () => {
  it('rejects initialization without the setup token', async () => {
    const response = await call(null, '/api/v1/setup/initialize', { method: 'POST', body: '{}' });
    expect(response.status).toBe(403);
    expect((await readBody(response)).error?.code).toBe('SETUP_FORBIDDEN');
  });

  it('provisions the six engineering roadmaps, supervisor and onboarding credentials', async () => {
    const response = await call(null, '/api/v1/setup/initialize', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.SETUP_TOKEN}` },
      body: '{}',
    });
    expect(response.status).toBe(201);

    const data = await readData<{
      initialCredentials: Array<{ name: string; email: string; temporaryPassword: string }>;
      warning: string;
    }>(response);
    expect(data.initialCredentials).toHaveLength(7);
    expect(data.initialCredentials.map((credential) => credential.email)).toContain('mostafa@cerberus.local');
    expect(data.initialCredentials.map((credential) => credential.email)).toContain('supervisor@cerberus.local');
    expect(data.warning).toContain('Temporary passwords');

    const counts = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM engineering_domains) AS domains,
      (SELECT COUNT(*) FROM milestones) AS milestones,
      (SELECT COUNT(*) FROM checkpoints) AS checkpoints,
      (SELECT COUNT(*) FROM tasks) AS tasks,
      (SELECT COUNT(*) FROM checkpoint_tasks) AS checkpointTasks`).first<Record<string, number>>();
    expect(counts).toMatchObject({ users: 7, domains: 6, milestones: 30, checkpoints: 30, tasks: 30, checkpointTasks: 30 });

    const adminCredential = data.initialCredentials.find((credential) => credential.email === 'mostafa@cerberus.local');
    expect(adminCredential).toBeDefined();
    const session = await login('mostafa@cerberus.local', adminCredential!.temporaryPassword);
    expect(session.mustChangePassword).toBe(true);

    const blocked = await call(session, '/api/v1/tasks');
    expect(blocked.status).toBe(403);

    const changed = await call(session, '/api/v1/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: adminCredential!.temporaryPassword, newPassword: 'Cerberus!Onboard2026' }),
    });
    expect(changed.status).toBe(200);

    const tasks = await call(session, '/api/v1/tasks');
    expect(tasks.status).toBe(200);
    const taskList = await readBody<unknown[]>(tasks);
    expect(taskList.data).toHaveLength(30);

    const checkpoints = await call(session, '/api/v1/tasks/checkpoints');
    const checkpointList = await readBody<unknown[]>(checkpoints);
    expect(checkpointList.data).toHaveLength(30);
  });

  it('refuses to initialize an already provisioned workspace', async () => {
    const response = await call(null, '/api/v1/setup/initialize', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.SETUP_TOKEN}` },
      body: '{}',
    });
    expect(response.status).toBe(409);
    expect((await readBody(response)).error?.code).toBe('ALREADY_INITIALIZED');
  });
});
