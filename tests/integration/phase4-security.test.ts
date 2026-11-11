import { beforeAll, describe, expect, it } from 'vitest';
import { totpCode } from '../../worker/services/mfa';
import {
  ADMIN_EMAIL,
  ADMIN_ID,
  MEMBER_EMAIL,
  MEMBER_ID,
  MEMBER_TWO_EMAIL,
  MEMBER_TWO_ID,
  SUPERVISOR_EMAIL,
  SUPERVISOR_ID,
  TEST_PASSWORD,
  call,
  databaseRun,
  databaseValue,
  login,
  readBody,
  readData,
  seedUsers,
} from './helpers';

interface ChallengeResponse {
  mfaRequired: boolean;
  challengeToken: string;
  expiresIn: number;
}

async function beginMfaChallenge(email: string): Promise<string> {
  const response = await call(null, '/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  expect(response.status).toBe(200);
  const body = await readBody<ChallengeResponse>(response);
  expect(body.data.mfaRequired).toBe(true);
  return body.data.challengeToken;
}

async function completeMfaLogin(email: string, secret: string): Promise<Response> {
  const challengeToken = await beginMfaChallenge(email);
  const code = await totpCode(secret, Math.floor(Date.now() / 1000 / 30));
  return call(null, '/api/v1/auth/login/mfa', {
    method: 'POST',
    body: JSON.stringify({ challengeToken, code }),
  });
}

async function loginFrom(email: string, ip: string): Promise<Response> {
  return call(null, '/api/v1/auth/login', {
    method: 'POST',
    headers: { 'CF-Connecting-IP': ip },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
}

describe('phase 4 credential hardening', () => {
  beforeAll(async () => {
    await seedUsers();
  });

  it('alerts the account owner when a completed sign-in comes from a new network', async () => {
    const first = await loginFrom(SUPERVISOR_EMAIL, '203.0.113.10');
    expect(first.status).toBe(200);

    const second = await loginFrom(SUPERVISOR_EMAIL, '198.51.100.20');
    expect(second.status).toBe(200);

    const alerts = await databaseValue<{ count: number }>(
      `SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND type = 'auth.new_signin'`, SUPERVISOR_ID,
    );
    expect(alerts?.count).toBe(1);

    const third = await loginFrom(SUPERVISOR_EMAIL, '198.51.100.20');
    expect(third.status).toBe(200);
    const unchanged = await databaseValue<{ count: number }>(
      `SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND type = 'auth.new_signin'`, SUPERVISOR_ID,
    );
    expect(unchanged?.count).toBe(1);

    const body = await databaseValue<{ body: string }>(
      `SELECT body FROM notifications WHERE user_id = ? AND type = 'auth.new_signin' LIMIT 1`, SUPERVISOR_ID,
    );
    expect(body?.body).toContain('Network fingerprint:');
    expect(body?.body).toContain('using a password.');
  });

  it('seals authenticator secrets at rest and still completes an MFA login', async () => {
    const member = await login(MEMBER_EMAIL);
    const setup = await readData<{ secret: string; otpauthUri: string }>(
      await call(member, '/api/v1/account/mfa/setup', { method: 'POST', body: JSON.stringify({}) }),
    );
    expect(setup.secret.length).toBeGreaterThan(20);

    const stored = await databaseValue<{ secret: string }>(`SELECT secret FROM user_mfa WHERE user_id = ?`, MEMBER_ID);
    expect(stored?.secret.startsWith('v1:')).toBe(true);
    expect(stored?.secret).not.toContain(setup.secret);

    const confirmationCode = await totpCode(setup.secret, Math.floor(Date.now() / 1000 / 30));
    const confirmed = await call(member, '/api/v1/account/mfa/confirm', {
      method: 'POST',
      body: JSON.stringify({ code: confirmationCode }),
    });
    expect(confirmed.status).toBe(200);
    const recoveryCodes = await readData<{ enabled: boolean; recoveryCodes: string[] }>(confirmed);
    expect(recoveryCodes.enabled).toBe(true);
    expect(recoveryCodes.recoveryCodes).toHaveLength(10);

    const loginResponse = await completeMfaLogin(MEMBER_EMAIL, setup.secret);
    expect(loginResponse.status).toBe(200);
    const afterLogin = await databaseValue<{ secret: string }>(`SELECT secret FROM user_mfa WHERE user_id = ?`, MEMBER_ID);
    expect(afterLogin?.secret.startsWith('v1:')).toBe(true);
  });

  it('lets an administrator reset a locked-out authenticator without crossing accounts', async () => {
    const admin = await login(ADMIN_EMAIL);

    const reset = await call(admin, `/api/v1/users/${MEMBER_ID}/mfa/reset`, { method: 'POST' });
    expect(reset.status).toBe(200);
    const result = await readData<{ reset: boolean; revokedSessions: number }>(reset);
    expect(result.reset).toBe(true);
    expect(result.revokedSessions).toBeGreaterThanOrEqual(1);

    const remaining = await databaseValue<{ count: number }>(`SELECT COUNT(*) AS count FROM user_mfa WHERE user_id = ?`, MEMBER_ID);
    expect(remaining?.count).toBe(0);
    const activeSessions = await databaseValue<{ count: number }>(
      `SELECT COUNT(*) AS count FROM sessions WHERE user_id = ? AND revoked_at IS NULL`, MEMBER_ID,
    );
    expect(activeSessions?.count).toBe(0);
    const notification = await databaseValue<{ count: number }>(
      `SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND type = 'account.mfa_reset'`, MEMBER_ID,
    );
    expect(notification?.count).toBe(1);

    const selfReset = await call(admin, `/api/v1/users/${ADMIN_ID}/mfa/reset`, { method: 'POST' });
    expect(selfReset.status).toBe(409);
    expect((await readBody(selfReset)).error?.code).toBe('SELF_MFA_RESET');

    const supervisor = await login(SUPERVISOR_EMAIL);
    const crossAccount = await call(supervisor, `/api/v1/users/${ADMIN_ID}/mfa/reset`, { method: 'POST' });
    expect(crossAccount.status).toBe(403);
  });

  it('upgrades a legacy plaintext secret after a successful verification', async () => {
    const legacySecret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    await databaseRun(`INSERT INTO user_mfa (user_id, secret, confirmed_at, recovery_codes_json)
      VALUES (?, ?, unixepoch(), '[]')`, MEMBER_TWO_ID, legacySecret);

    const response = await completeMfaLogin(MEMBER_TWO_EMAIL, legacySecret);
    expect(response.status).toBe(200);

    const resealed = await databaseValue<{ secret: string }>(`SELECT secret FROM user_mfa WHERE user_id = ?`, MEMBER_TWO_ID);
    expect(resealed?.secret.startsWith('v1:')).toBe(true);
    expect(resealed?.secret).not.toContain(legacySecret);
  });
});
