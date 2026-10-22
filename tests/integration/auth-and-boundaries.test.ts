import { beforeAll, describe, expect, it } from 'vitest';
import app from '../../worker/index';
import {
  ADMIN_EMAIL,
  CHANGED_PASSWORD,
  MEMBER_EMAIL,
  MEMBER_ID,
  SUPERVISOR_EMAIL,
  TEMP_EMAIL,
  TEST_PASSWORD,
  bindings,
  call,
  createTask,
  login,
  readBody,
  seedUsers,
} from './helpers';

describe('authentication, CSRF and role boundaries', () => {
  beforeAll(async () => {
    await seedUsers();
  });

  it('issues an HttpOnly SameSite session cookie and a CSRF token', async () => {
    const response = await call(null, '/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: MEMBER_EMAIL, password: TEST_PASSWORD }),
    });

    expect(response.status).toBe(200);
    const sessionCookie = response.headers.getSetCookie().find((cookie) => cookie.startsWith('cerberus_session='));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('SameSite=Strict');

    const payload = await readBody<{ csrfToken: string; mustChangePassword: boolean }>(response);
    expect(payload.data.csrfToken).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(payload.data.mustChangePassword).toBe(false);
  });

  it('rejects the development cookie name and unsafe origins in production', async () => {
    const session = await login(MEMBER_EMAIL);
    const productionBindings = { ...bindings, APP_ENV: 'production', APP_ORIGIN: 'https://cerberus.example' };

    const fallback = await app.request('/api/v1/auth/me', { headers: { cookie: session.cookie } }, productionBindings);
    expect(fallback.status).toBe(401);

    const crossOrigin = await app.request('/api/v1/auth/me', {
      headers: { cookie: session.cookie, Origin: 'https://evil.example' },
    }, productionBindings);
    expect(crossOrigin.status).toBe(403);
    expect((await readBody(crossOrigin)).error?.code).toBe('ORIGIN_DENIED');

    const unconfigured = await app.request('/api/v1/health', {}, {
      ...bindings,
      APP_ENV: 'production',
      APP_ORIGIN: undefined,
    });
    expect(unconfigured.status).toBe(503);
    expect((await readBody(unconfigured)).error?.code).toBe('ORIGIN_NOT_CONFIGURED');

    const health = await app.request('/api/v1/health', {}, productionBindings);
    expect(health.status).toBe(200);
    expect(health.headers.get('cache-control')).toBe('no-store');
    expect((await readBody<{ service: string; environment?: string }>(health)).data.environment).toBeUndefined();
  });

  it('rate-limits repeated failed logins for the same account', async () => {
    const email = `missing-${Date.now()}@cerberus.test`;
    let lastStatus = 0;
    let lastCode: string | undefined;
    for (let attempt = 0; attempt < 9; attempt += 1) {
      const response = await call(null, '/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password: 'WrongPassword!2026' }),
      });
      lastStatus = response.status;
      lastCode = (await readBody(response)).error?.code;
    }
    expect(lastStatus).toBe(429);
    expect(lastCode).toBe('RATE_LIMITED');
  });

  it('rejects unauthenticated access and mutations without the CSRF token', async () => {
    const unauthenticated = await call(null, '/api/v1/tasks');
    expect(unauthenticated.status).toBe(401);
    expect((await readBody(unauthenticated)).error?.code).toBe('UNAUTHENTICATED');

    const session = await login(MEMBER_EMAIL);
    const response = await call({ ...session, csrf: 'not-the-session-token' }, '/api/v1/tasks/any-task/status', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'in_progress' }),
    });
    expect(response.status).toBe(403);
    expect((await readBody(response)).error?.code).toBe('CSRF_INVALID');
  });

  it('blocks supervisor writes while allowing read and feedback access', async () => {
    const supervisor = await login(SUPERVISOR_EMAIL);
    const admin = await login(ADMIN_EMAIL);
    const taskId = await createTask(admin, { assigneeId: MEMBER_ID, title: 'Supervisor boundary task' });

    const statusChange = await call(supervisor, `/api/v1/tasks/${taskId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'in_progress' }),
    });
    expect(statusChange.status).toBe(403);

    const wiki = await call(supervisor, '/api/v1/workspace/wiki', {
      method: 'POST',
      body: JSON.stringify({ title: 'Supervisor page', slug: 'supervisor-page', category: 'Testing', contentMarkdown: '# no' }),
    });
    expect(wiki.status).toBe(403);

    const read = await call(supervisor, '/api/v1/tasks');
    expect(read.status).toBe(200);

    const feedback = await call(supervisor, `/api/v1/workspace/supervisor/feedback/${MEMBER_ID}`, {
      method: 'POST',
      body: JSON.stringify({ body: 'Please attach the measured latency trace.' }),
    });
    expect(feedback.status).toBe(201);
  });

  it('forces temporary-password users to change before workspace access', async () => {
    const temp = await login(TEMP_EMAIL);
    expect(temp.mustChangePassword).toBe(true);

    const blocked = await call(temp, '/api/v1/tasks');
    expect(blocked.status).toBe(403);
    expect((await readBody(blocked)).error?.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const changed = await call(temp, '/api/v1/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: TEST_PASSWORD, newPassword: CHANGED_PASSWORD }),
    });
    expect(changed.status).toBe(200);

    const allowed = await call(temp, '/api/v1/tasks');
    expect(allowed.status).toBe(200);
  });

  it('revokes sessions when an administrator suspends an account', async () => {
    const admin = await login(ADMIN_EMAIL);
    const member = await login(MEMBER_EMAIL);

    const suspend = await call(admin, `/api/v1/users/${MEMBER_ID}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'suspended' }),
    });
    expect(suspend.status).toBe(200);

    const after = await call(member, '/api/v1/auth/me');
    expect(after.status).toBe(401);

    const reactivate = await call(admin, `/api/v1/users/${MEMBER_ID}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'active' }),
    });
    expect(reactivate.status).toBe(200);
  });
});
