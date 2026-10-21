import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_EMAIL, call, login, readBody, seedUsers } from './helpers';

describe('integration harness', () => {
  beforeAll(async () => {
    await seedUsers();
  });

  it('serves the health endpoint from the real worker', async () => {
    const response = await call(null, '/api/v1/health');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const body = await readBody<{ service: string; environment: string }>(response);
    expect(body.data.service).toBe('cerberus-workspace');
  });

  it('authenticates a seeded administrator and resolves permissions from D1', async () => {
    const session = await login(ADMIN_EMAIL);
    const response = await call(session, '/api/v1/auth/me');
    expect(response.status).toBe(200);
    const body = await readBody<{ user: { email: string; roles: string[]; permissions: string[] } }>(response);
    expect(body.data.user.email).toBe(ADMIN_EMAIL);
    expect(body.data.user.roles).toContain('super_admin');
    expect(body.data.user.permissions).toEqual(expect.arrayContaining([
      'task.manage', 'task.work', 'review.admin', 'workspace.admin',
    ]));
  });
});
