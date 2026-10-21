import { beforeAll, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { sha256 } from '../../worker/services/security';
import {
  ADMIN_EMAIL,
  MEMBER_EMAIL,
  MEMBER_TWO_EMAIL,
  MEMBER_TWO_ID,
  call,
  databaseValue,
  login,
  readBody,
  readData,
  seedUsers,
  type Session,
} from './helpers';

const NEW_PASSWORD = 'Recovered!Pass2026';

describe('administrative password recovery', () => {
  let admin: Session;
  let member: Session;
  let memberTwo: Session;

  beforeAll(async () => {
    await seedUsers();
    admin = await login(ADMIN_EMAIL);
    member = await login(MEMBER_EMAIL);
    memberTwo = await login(MEMBER_TWO_EMAIL);
  });

  it('rejects reset-link issuance by non-administrators', async () => {
    const response = await call(member, `/api/v1/users/${MEMBER_TWO_ID}/reset-password`, { method: 'POST' });
    expect(response.status).toBe(403);
    expect((await readBody(response)).error?.code).toBe('FORBIDDEN');
  });

  it('rejects weak replacement passwords without consuming the token', async () => {
    const issued = await call(admin, `/api/v1/users/${MEMBER_TWO_ID}/reset-password`, { method: 'POST' });
    expect(issued.status).toBe(200);
    const { token } = await readData<{ token: string }>(issued);

    const weak = await call(null, '/api/v1/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password: 'short' }),
    });
    expect(weak.status).toBe(422);

    const row = await databaseValue<{ used_at: number | null }>(`SELECT used_at FROM password_reset_tokens WHERE token_hash=?`, await sha256(token));
    expect(row?.used_at).toBeNull();
  });

  it('resets the password once, revokes sessions and retires the token', async () => {
    const issued = await call(admin, `/api/v1/users/${MEMBER_TWO_ID}/reset-password`, { method: 'POST' });
    expect(issued.status).toBe(200);
    const data = await readData<{ token: string; resetUrl: string; expiresAt: number }>(issued);
    expect(data.token.length).toBeGreaterThanOrEqual(32);
    expect(data.resetUrl).toContain(encodeURIComponent(data.token));
    expect(data.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));

    const reset = await call(null, '/api/v1/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token: data.token, password: NEW_PASSWORD }),
    });
    expect(reset.status).toBe(200);
    expect((await readData<{ reset: boolean }>(reset)).reset).toBe(true);

    const previousSession = await call(memberTwo, '/api/v1/auth/me');
    expect(previousSession.status).toBe(401);

    const activeSessions = await databaseValue<{ count: number }>(`SELECT COUNT(*) AS count FROM sessions WHERE user_id=? AND revoked_at IS NULL`, MEMBER_TWO_ID);
    expect(activeSessions?.count).toBe(0);

    const oldPassword = await call(null, '/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: MEMBER_TWO_EMAIL, password: 'Cerberus!Test2026' }),
    });
    expect(oldPassword.status).toBe(401);

    const newPasswordLogin = await call(null, '/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: MEMBER_TWO_EMAIL, password: NEW_PASSWORD }),
    });
    expect(newPasswordLogin.status).toBe(200);

    const reuse = await call(null, '/api/v1/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token: data.token, password: 'Another!Pass2026' }),
    });
    expect(reuse.status).toBe(400);
    expect((await readBody(reuse)).error?.code).toBe('RESET_TOKEN_INVALID');

    const tokenRow = await databaseValue<{ used_at: number | null }>(`SELECT used_at FROM password_reset_tokens WHERE token_hash=?`, await sha256(data.token));
    expect(tokenRow?.used_at).toBeGreaterThan(0);
  });

  it('rejects expired reset tokens', async () => {
    const token = 'expired-reset-token-for-integration-coverage';
    const tokenHash = await sha256(token);
    await env.DB.prepare(`INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_by)
      VALUES (?, ?, ?, unixepoch() - 60, ?)`).bind('reset_expired_test', MEMBER_TWO_ID, tokenHash, 'user_test_admin').run();

    const response = await call(null, '/api/v1/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password: 'Expired!Pass2026' }),
    });
    expect(response.status).toBe(400);
    expect((await readBody(response)).error?.code).toBe('RESET_TOKEN_INVALID');
  });

  it('refuses reset links for suspended accounts', async () => {
    const suspend = await call(admin, `/api/v1/users/${MEMBER_TWO_ID}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'suspended' }),
    });
    expect(suspend.status).toBe(200);

    const response = await call(admin, `/api/v1/users/${MEMBER_TWO_ID}/reset-password`, { method: 'POST' });
    expect(response.status).toBe(409);
    expect((await readBody(response)).error?.code).toBe('ACCOUNT_NOT_ACTIVE');
  });
});
