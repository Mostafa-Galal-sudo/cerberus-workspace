import { beforeAll, describe, expect, it } from 'vitest';
import { parseRecoveryHashes, totpCode } from '../../worker/services/mfa';
import {
  ADMIN_EMAIL,
  MEMBER_EMAIL,
  MEMBER_ID,
  MEMBER_TWO_EMAIL,
  MEMBER_TWO_ID,
  TEST_PASSWORD,
  call,
  databaseRun,
  databaseValue,
  login,
  readBody,
  readData,
  seedUsers,
  type Session,
} from './helpers';

interface ChallengeResponse {
  mfaRequired: boolean;
  challengeToken: string;
  expiresIn: number;
}

function sessionFrom(response: Response, csrf: string): Session {
  const cookie = response.headers.getSetCookie()
    .map((value) => value.split(';')[0])
    .find((value) => value.startsWith('cerberus_session='));
  if (!cookie) throw new Error('MFA login did not set a session cookie');
  return { cookie, csrf, mustChangePassword: false };
}

async function beginMfaChallenge(email: string): Promise<string> {
  const response = await call(null, '/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  expect(response.status).toBe(200);
  const body = await readBody<ChallengeResponse>(response);
  expect(body.data.mfaRequired).toBe(true);
  expect(body.data.challengeToken.length).toBeGreaterThan(30);
  expect(response.headers.getSetCookie().some((value) => value.startsWith('cerberus_session='))).toBe(false);
  return body.data.challengeToken;
}

describe('phase 3 account security', () => {
  beforeAll(async () => {
    await seedUsers();
  });

  it('locks idle sessions and records the revocation', async () => {
    const session = await login(MEMBER_EMAIL);
    const sessions = await readData<{ sessions: Array<{ id: string; current: boolean }> }>(
      await call(session, '/api/v1/account/sessions'),
    );
    const current = sessions.sessions.find((row) => row.current);
    expect(current).toBeTruthy();

    await databaseRun(`UPDATE sessions SET last_seen_at = unixepoch() - 100000 WHERE id = ?`, current?.id);
    const blocked = await call(session, '/api/v1/account/overview');
    expect(blocked.status).toBe(401);
    const body = await readBody<unknown>(blocked);
    expect(body.error?.code).toBe('SESSION_IDLE_TIMEOUT');

    const revoked = await databaseValue<{ revoked_at: number | null }>(`SELECT revoked_at FROM sessions WHERE id = ?`, current?.id);
    expect(revoked?.revoked_at).not.toBeNull();

    const retry = await call(session, '/api/v1/account/overview');
    expect(retry.status).toBe(401);
  });

  it('lists sessions and revokes other devices without crossing accounts', async () => {
    const first = await login(MEMBER_EMAIL);
    const second = await login(MEMBER_EMAIL);
    const third = await login(MEMBER_EMAIL);

    const listed = await readData<{ sessions: Array<{ id: string; current: boolean; userAgent: string | null }> }>(
      await call(first, '/api/v1/account/sessions'),
    );
    expect(listed.sessions.filter((row) => row.current)).toHaveLength(1);
    expect(listed.sessions.length).toBeGreaterThanOrEqual(3);

    const currentId = listed.sessions.find((row) => row.current)?.id;
    const other = listed.sessions.find((row) => !row.current);

    const admin = await login(ADMIN_EMAIL);
    const crossAccount = await call(admin, `/api/v1/account/sessions/${currentId}/revoke`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(crossAccount.status).toBe(404);

    const revoked = await call(first, `/api/v1/account/sessions/${other?.id}/revoke`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(revoked.status).toBe(200);

    const revokeOthers = await readData<{ revokedCount: number }>(
      await call(first, '/api/v1/account/sessions/revoke-others', { method: 'POST', body: JSON.stringify({}) }),
    );
    expect(revokeOthers.revokedCount).toBeGreaterThanOrEqual(1);

    expect((await call(second, '/api/v1/account/overview')).status).toBe(401);
    expect((await call(third, '/api/v1/account/overview')).status).toBe(401);
    expect((await call(first, '/api/v1/account/overview')).status).toBe(200);
  });

  it('shows a paginated authentication history with failures and successes', async () => {
    const failed = await call(null, '/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: MEMBER_EMAIL, password: 'Wrong!Password2026' }),
    });
    expect(failed.status).toBe(401);

    const session = await login(MEMBER_EMAIL);
    const response = await call(session, '/api/v1/account/login-history?page=1&limit=10');
    expect(response.status).toBe(200);
    const body = await readBody<{ events: Array<{ success: boolean; method: string; reason: string | null }> }>(response);
    expect(body.meta?.total).toBeGreaterThan(1);
    expect(body.data.events.some((event) => event.success && event.method === 'password')).toBe(true);
    expect(body.data.events.some((event) => !event.success && event.reason === 'invalid_credentials')).toBe(true);
  });

  it('completes the full TOTP lifecycle with replay and recovery protection', async () => {
    const session = await login(MEMBER_TWO_EMAIL);
    const initial = await readData<{ security: { mfa: { enabled: boolean } } }>(
      await call(session, '/api/v1/account/overview'),
    );
    expect(initial.security.mfa.enabled).toBe(false);

    const setup = await readData<{ secret: string; otpauthUri: string; account: string }>(
      await call(session, '/api/v1/account/mfa/setup', { method: 'POST', body: JSON.stringify({}) }),
    );
    expect(setup.account).toBe(MEMBER_TWO_EMAIL);
    expect(setup.otpauthUri).toContain(setup.secret);

    const confirmationCode = await totpCode(setup.secret, Math.floor(Date.now() / 1000 / 30));
    const confirmed = await call(session, '/api/v1/account/mfa/confirm', {
      method: 'POST',
      body: JSON.stringify({ code: confirmationCode }),
    });
    expect(confirmed.status).toBe(200);
    const { recoveryCodes } = await readData<{ recoveryCodes: string[] }>(confirmed);
    expect(recoveryCodes).toHaveLength(10);

    const stored = await databaseValue<{ confirmed_at: number; last_used_step: number | null; recovery_codes_json: string }>(
      `SELECT confirmed_at, last_used_step, recovery_codes_json FROM user_mfa WHERE user_id = ?`, MEMBER_TWO_ID,
    );
    expect(stored?.confirmed_at).toBeTruthy();
    expect(stored?.last_used_step).toBeNull();
    expect(parseRecoveryHashes(stored?.recovery_codes_json)).toHaveLength(10);
    expect(stored?.recovery_codes_json).not.toContain(recoveryCodes[0]);

    const challenge = await beginMfaChallenge(MEMBER_TWO_EMAIL);
    const verificationCode = await totpCode(setup.secret, Math.floor(Date.now() / 1000 / 30));
    const verified = await call(null, '/api/v1/auth/login/mfa', {
      method: 'POST',
      body: JSON.stringify({ challengeToken: challenge, code: verificationCode }),
    });
    expect(verified.status).toBe(200);
    const verifiedBody = await readBody<{ csrfToken: string }>(verified);
    const mfaSession = sessionFrom(verified, verifiedBody.data.csrfToken);

    const afterLogin = await databaseValue<{ last_used_step: number | null }>(
      `SELECT last_used_step FROM user_mfa WHERE user_id = ?`, MEMBER_TWO_ID,
    );
    expect(afterLogin?.last_used_step).not.toBeNull();
    const consumedStep = afterLogin?.last_used_step ?? 0;

    // Replaying the consumed step must fail even though it is inside the skew window.
    const replayChallenge = await beginMfaChallenge(MEMBER_TWO_EMAIL);
    const replay = await call(null, '/api/v1/auth/login/mfa', {
      method: 'POST',
      body: JSON.stringify({ challengeToken: replayChallenge, code: await totpCode(setup.secret, consumedStep) }),
    });
    expect(replay.status).toBe(401);
    expect((await readBody<unknown>(replay)).error?.code).toBe('MFA_CODE_INVALID');
    const attempts = await databaseValue<{ attempts: number }>(
      `SELECT attempts FROM login_challenges WHERE consumed_at IS NULL AND user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`, MEMBER_TWO_ID,
    );
    expect(attempts?.attempts).toBe(1);

    // Expired challenges are rejected before code comparison.
    const expiredChallenge = await beginMfaChallenge(MEMBER_TWO_EMAIL);
    await databaseRun(`UPDATE login_challenges SET expires_at = unixepoch() - 1 WHERE user_id = ? AND consumed_at IS NULL`, MEMBER_TWO_ID);
    const expired = await call(null, '/api/v1/auth/login/mfa', {
      method: 'POST',
      body: JSON.stringify({ challengeToken: expiredChallenge, code: await totpCode(setup.secret, Math.floor(Date.now() / 1000 / 30)) }),
    });
    expect(expired.status).toBe(401);
    expect((await readBody<unknown>(expired)).error?.code).toBe('MFA_CHALLENGE_INVALID');

    // A recovery code authenticates once and is removed from the stored hashes.
    const recoveryChallenge = await beginMfaChallenge(MEMBER_TWO_EMAIL);
    const recoveryLogin = await call(null, '/api/v1/auth/login/mfa', {
      method: 'POST',
      body: JSON.stringify({ challengeToken: recoveryChallenge, code: recoveryCodes[0] }),
    });
    expect(recoveryLogin.status).toBe(200);
    const recoveryBody = await readBody<{ csrfToken: string }>(recoveryLogin);
    const recoverySession = sessionFrom(recoveryLogin, recoveryBody.data.csrfToken);

    const afterRecovery = await databaseValue<{ recovery_codes_json: string; last_used_step: number | null }>(
      `SELECT recovery_codes_json, last_used_step FROM user_mfa WHERE user_id = ?`, MEMBER_TWO_ID,
    );
    expect(parseRecoveryHashes(afterRecovery?.recovery_codes_json)).toHaveLength(9);
    expect(afterRecovery?.last_used_step).toBe(consumedStep);

    const reuseChallenge = await beginMfaChallenge(MEMBER_TWO_EMAIL);
    const reuse = await call(null, '/api/v1/auth/login/mfa', {
      method: 'POST',
      body: JSON.stringify({ challengeToken: reuseChallenge, code: recoveryCodes[0] }),
    });
    expect(reuse.status).toBe(401);

    const history = await readData<{ events: Array<{ method: string; success: boolean }> }>(
      await call(recoverySession, '/api/v1/account/login-history?limit=50'),
    );
    expect(history.events.some((event) => event.method === 'mfa' && event.success)).toBe(true);
    expect(history.events.some((event) => event.method === 'recovery_code' && event.success)).toBe(true);

    // Disabling requires the password plus a valid code and revokes other devices.
    const wrongPassword = await call(session, '/api/v1/account/mfa/disable', {
      method: 'POST',
      body: JSON.stringify({ password: 'Wrong!Password2026', code: recoveryCodes[1] }),
    });
    expect(wrongPassword.status).toBe(401);

    const disabled = await call(session, '/api/v1/account/mfa/disable', {
      method: 'POST',
      body: JSON.stringify({ password: TEST_PASSWORD, code: recoveryCodes[1] }),
    });
    expect(disabled.status).toBe(200);

    const remaining = await databaseValue<{ count: number }>(
      `SELECT COUNT(*) AS count FROM user_mfa WHERE user_id = ?`, MEMBER_TWO_ID,
    );
    expect(remaining?.count).toBe(0);
    expect((await call(mfaSession, '/api/v1/account/overview')).status).toBe(401);
    expect((await call(recoverySession, '/api/v1/account/overview')).status).toBe(401);
    expect((await call(session, '/api/v1/account/overview')).status).toBe(200);

    const memberTwo = await login(MEMBER_TWO_EMAIL);
    expect(memberTwo.csrf).toBeTruthy();
  });

  it('supports regenerating recovery codes after re-enabling MFA', async () => {
    const session = await login(MEMBER_TWO_EMAIL);
    const setup = await readData<{ secret: string }>(
      await call(session, '/api/v1/account/mfa/setup', { method: 'POST', body: JSON.stringify({}) }),
    );
    const code = await totpCode(setup.secret, Math.floor(Date.now() / 1000 / 30));
    const confirmed = await readData<{ recoveryCodes: string[] }>(
      await call(session, '/api/v1/account/mfa/confirm', { method: 'POST', body: JSON.stringify({ code }) }),
    );

    const regenerated = await readData<{ recoveryCodes: string[] }>(
      await call(session, '/api/v1/account/mfa/recovery-codes', {
        method: 'POST',
        body: JSON.stringify({ password: TEST_PASSWORD, code: confirmed.recoveryCodes[0] }),
      }),
    );
    expect(regenerated.recoveryCodes).toHaveLength(10);
    expect(regenerated.recoveryCodes).not.toEqual(confirmed.recoveryCodes);

    await call(session, '/api/v1/account/mfa/disable', {
      method: 'POST',
      body: JSON.stringify({ password: TEST_PASSWORD, code: regenerated.recoveryCodes[0] }),
    });
  });
});

describe('phase 3 assistant threads', () => {
  beforeAll(async () => {
    await databaseRun(`INSERT INTO blockers (id, project_id, reporter_id, title, description, severity, status)
      VALUES ('blocker_phase3', 'project_cerberus', ?, 'Antenna calibration drift blocks RF baseline',
        'The measured RSSI baseline drifts beyond tolerance until the antenna is recalibrated.', 'critical', 'open')`, MEMBER_ID);
  });

  it('persists threads, cites retrieved records and audits read-only tools', async () => {
    const member = await login(MEMBER_EMAIL);
    const created = await call(member, '/api/v1/assistant/threads', { method: 'POST', body: JSON.stringify({}) });
    expect(created.status).toBe(201);
    const thread = await readData<{ thread: { id: string; title: string } }>(created);
    expect(thread.thread.title).toBe('New assistant thread');

    const sent = await call(member, `/api/v1/assistant/threads/${thread.thread.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ message: 'What are the critical project blockers currently open?' }),
    });
    expect(sent.status).toBe(201);
    const answer = await readData<{
      thread: { title: string; messageCount: number };
      message: { content: string; citations: Array<{ type: string; id: string }>; toolRuns: Array<{ tool: string; resultCount: number }> };
      usageId: string;
    }>(sent);
    expect(answer.thread.messageCount).toBe(2);
    expect(answer.thread.title).toContain('critical project blockers');
    expect(answer.message.content.length).toBeGreaterThan(20);
    expect(answer.message.citations.some((citation) => citation.type === 'blocker' && citation.id === 'blocker_phase3')).toBe(true);
    expect(answer.message.toolRuns.some((run) => run.tool === 'open_blockers')).toBe(true);
    expect(answer.message.toolRuns.every((run) => run.resultCount >= 0)).toBe(true);

    const usage = await databaseValue<{ thread_id: string | null }>(
      `SELECT thread_id FROM assistant_usage WHERE id = ?`, answer.usageId,
    );
    expect(usage?.thread_id).toBe(thread.thread.id);

    const auditCount = await databaseValue<{ count: number }>(
      `SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'assistant.tool_invoked' AND resource_id = ?`, thread.thread.id,
    );
    expect(auditCount?.count).toBeGreaterThan(0);

    const detail = await readData<{ messages: Array<{ role: string; citations: unknown[] }> }>(
      await call(member, `/api/v1/assistant/threads/${thread.thread.id}`),
    );
    expect(detail.messages.map((message) => message.role)).toEqual(['user', 'assistant']);

    const listed = await readBody<{ data: { threads: Array<{ id: string }> } }>(
      await call(member, '/api/v1/assistant/threads?limit=10'),
    );
    expect(listed.data.threads.some((row) => row.id === thread.thread.id)).toBe(true);
    expect(listed.meta?.total).toBeGreaterThanOrEqual(1);

    const renamed = await call(member, `/api/v1/assistant/threads/${thread.thread.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'RF blockers review' }),
    });
    expect(renamed.status).toBe(200);
    expect((await readData<{ thread: { title: string } }>(renamed)).thread.title).toBe('RF blockers review');
  });

  it('isolates threads per user and keeps archived threads read-only', async () => {
    const member = await login(MEMBER_EMAIL);
    const admin = await login(ADMIN_EMAIL);

    const memberThread = await readData<{ thread: { id: string } }>(
      await call(member, '/api/v1/assistant/threads', { method: 'POST', body: JSON.stringify({ title: 'Member private thread' }) }),
    );
    const adminThread = await readData<{ thread: { id: string } }>(
      await call(admin, '/api/v1/assistant/threads', { method: 'POST', body: JSON.stringify({ title: 'Admin private thread' }) }),
    );

    expect((await call(member, `/api/v1/assistant/threads/${adminThread.thread.id}`)).status).toBe(404);
    expect((await call(admin, `/api/v1/assistant/threads/${memberThread.thread.id}`)).status).toBe(404);
    expect((await call(member, `/api/v1/assistant/threads/${adminThread.thread.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ message: 'Show me the admin thread' }),
    })).status).toBe(404);

    const archived = await call(member, `/api/v1/assistant/threads/${memberThread.thread.id}`, {
      method: 'DELETE',
      body: JSON.stringify({}),
    });
    expect(archived.status).toBe(200);

    const listed = await readBody<{ data: { threads: Array<{ id: string }> } }>(
      await call(member, '/api/v1/assistant/threads?limit=50'),
    );
    expect(listed.data.threads.some((row) => row.id === memberThread.thread.id)).toBe(false);

    const blocked = await call(member, `/api/v1/assistant/threads/${memberThread.thread.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ message: 'Continue this archived thread' }),
    });
    expect(blocked.status).toBe(409);
  });

  it('keeps the legacy stateless chat endpoint available', async () => {
    const member = await login(MEMBER_EMAIL);
    const response = await call(member, '/api/v1/assistant/chat', {
      method: 'POST',
      body: JSON.stringify({ message: 'What are the current blockers?' }),
    });
    expect(response.status).toBe(200);
    const data = await readData<{ reply: string; sources: unknown[]; citations: unknown[]; usageId: string }>(response);
    expect(data.reply).toContain('blockers');
    expect(Array.isArray(data.sources)).toBe(true);
    expect(Array.isArray(data.citations)).toBe(true);

    const usage = await databaseValue<{ thread_id: string | null }>(
      `SELECT thread_id FROM assistant_usage WHERE id = ?`, data.usageId,
    );
    expect(usage?.thread_id).toBeNull();
  });
});
