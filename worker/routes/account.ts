import { Hono } from 'hono';
import { deleteCookie } from 'hono/cookie';
import {
  mfaConfirmSchema,
  mfaDisableSchema,
} from '../../shared/schemas/account';
import { requireAuth, requirePasswordChanged } from '../middleware/auth';
import { audit } from '../services/audit';
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  matchRecoveryCode,
  otpauthUri,
  parseRecoveryHashes,
  verifyTotp,
} from '../services/mfa';
import { consumeRateLimit } from '../services/rate-limit';
import { verifyPassword } from '../services/security';
import { idleTimeoutMinutes } from '../services/session-security';
import type { Env, Variables } from '../types';

export const accountRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
accountRoutes.use('*', requireAuth, requirePasswordChanged);

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const RECOVERY_CODE_COUNT = 10;

function pageParams(rawPage: string | undefined, rawLimit: string | undefined) {
  const requestedPage = Number(rawPage ?? 1);
  const requestedLimit = Number(rawLimit ?? DEFAULT_PAGE_SIZE);
  const page = Number.isFinite(requestedPage) ? Math.max(1, Math.trunc(requestedPage)) : 1;
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(requestedLimit)))
    : DEFAULT_PAGE_SIZE;
  return { page, limit, offset: (page - 1) * limit };
}

accountRoutes.get('/overview', async (context) => {
  const user = context.get('user');
  const [mfa, sessions, lastLogin] = await Promise.all([
    context.env.DB.prepare(`SELECT confirmed_at, recovery_codes_json FROM user_mfa WHERE user_id = ?`)
      .bind(user.id).first<{ confirmed_at: number | null; recovery_codes_json: string }>(),
    context.env.DB.prepare(`SELECT COUNT(*) AS count FROM sessions
      WHERE user_id = ? AND revoked_at IS NULL AND expires_at > unixepoch()`).bind(user.id)
      .first<{ count: number }>(),
    context.env.DB.prepare(`SELECT created_at, method, reason FROM login_events
      WHERE user_id = ? AND success = 1 ORDER BY created_at DESC LIMIT 1`).bind(user.id)
      .first<{ created_at: number; method: string; reason: string | null }>(),
  ]);

  return context.json({
    ok: true,
    data: {
      profile: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        specialization: user.specialization,
        roles: user.roles,
      },
      security: {
        idleTimeoutMinutes: idleTimeoutMinutes(context.env),
        activeSessions: sessions?.count ?? 0,
        mfa: {
          enabled: Boolean(mfa?.confirmed_at),
          confirmedAt: mfa?.confirmed_at ?? null,
          recoveryCodesRemaining: parseRecoveryHashes(mfa?.recovery_codes_json).length,
        },
        lastLoginAt: lastLogin?.created_at ?? null,
        lastLoginMethod: lastLogin?.method ?? null,
      },
    },
  });
});

accountRoutes.get('/sessions', async (context) => {
  const user = context.get('user');
  const { page, limit, offset } = pageParams(context.req.query('page'), context.req.query('limit'));
  const [rows, total] = await Promise.all([
    context.env.DB.prepare(`SELECT id, user_agent, created_at, last_seen_at, expires_at
      FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > unixepoch()
      ORDER BY last_seen_at DESC, created_at DESC LIMIT ? OFFSET ?`)
      .bind(user.id, limit, offset)
      .all<{ id: string; user_agent: string | null; created_at: number; last_seen_at: number; expires_at: number }>(),
    context.env.DB.prepare(`SELECT COUNT(*) AS count FROM sessions
      WHERE user_id = ? AND revoked_at IS NULL AND expires_at > unixepoch()`).bind(user.id)
      .first<{ count: number }>(),
  ]);
  const totalCount = total?.count ?? 0;

  return context.json({
    ok: true,
    data: {
      sessions: rows.results.map((row) => ({
        id: row.id,
        userAgent: row.user_agent,
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
        expiresAt: row.expires_at,
        current: row.id === context.get('sessionId'),
      })),
    },
    meta: { page, limit, total: totalCount, hasMore: page * limit < totalCount },
  });
});

accountRoutes.post('/sessions/revoke-others', async (context) => {
  const user = context.get('user');
  const result = await context.env.DB.prepare(`UPDATE sessions SET revoked_at = unixepoch()
    WHERE user_id = ? AND id <> ? AND revoked_at IS NULL`).bind(user.id, context.get('sessionId')).run();
  await audit(context.env, user.id, 'session.revoked_others', 'user', user.id, {
    revokedCount: result.meta.changes ?? 0,
  });
  return context.json({ ok: true, data: { revokedCount: result.meta.changes ?? 0 } });
});

accountRoutes.post('/sessions/:sessionId/revoke', async (context) => {
  const user = context.get('user');
  const sessionId = context.req.param('sessionId');
  const session = await context.env.DB.prepare(`SELECT id FROM sessions
    WHERE id = ? AND user_id = ? AND revoked_at IS NULL`).bind(sessionId, user.id).first<{ id: string }>();
  if (!session) {
    return context.json({ ok: false, error: { code: 'SESSION_NOT_FOUND', message: 'That session is no longer active' } }, 404);
  }

  await context.env.DB.prepare(`UPDATE sessions SET revoked_at = unixepoch() WHERE id = ?`).bind(session.id).run();
  const current = session.id === context.get('sessionId');
  await audit(context.env, user.id, 'session.revoked', 'session', session.id, { current });
  if (current) {
    deleteCookie(context, '__Host-cerberus_session', {
      path: '/', secure: true, httpOnly: true, sameSite: 'Strict',
    });
    deleteCookie(context, 'cerberus_session', {
      path: '/', secure: context.env.APP_ENV === 'production', httpOnly: true, sameSite: 'Strict',
    });
  }
  return context.json({ ok: true, data: { revoked: true, current } });
});

accountRoutes.get('/login-history', async (context) => {
  const user = context.get('user');
  const { page, limit, offset } = pageParams(context.req.query('page'), context.req.query('limit'));
  const [rows, total] = await Promise.all([
    context.env.DB.prepare(`SELECT id, success, method, reason, user_agent, substr(ip_hash, 1, 10) AS ip_fingerprint, created_at
      FROM login_events WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`)
      .bind(user.id, limit, offset)
      .all<{
        id: string; success: number; method: string; reason: string | null;
        user_agent: string | null; ip_fingerprint: string | null; created_at: number;
      }>(),
    context.env.DB.prepare(`SELECT COUNT(*) AS count FROM login_events WHERE user_id = ?`).bind(user.id)
      .first<{ count: number }>(),
  ]);
  const totalCount = total?.count ?? 0;

  return context.json({
    ok: true,
    data: {
      events: rows.results.map((row) => ({
        id: row.id,
        success: row.success === 1,
        method: row.method,
        reason: row.reason,
        userAgent: row.user_agent,
        ipFingerprint: row.ip_fingerprint,
        createdAt: row.created_at,
      })),
    },
    meta: { page, limit, total: totalCount, hasMore: page * limit < totalCount },
  });
});

accountRoutes.post('/mfa/setup', async (context) => {
  const user = context.get('user');
  if (!await consumeRateLimit(context.env, `account-mfa:${user.id}`, 20, 900)) {
    return context.json({ ok: false, error: { code: 'RATE_LIMITED', message: 'Too many security requests. Try again later.' } }, 429);
  }

  const existing = await context.env.DB.prepare(`SELECT confirmed_at FROM user_mfa WHERE user_id = ?`)
    .bind(user.id).first<{ confirmed_at: number | null }>();
  if (existing?.confirmed_at) {
    return context.json({ ok: false, error: { code: 'MFA_ALREADY_ENABLED', message: 'Authenticator protection is already enabled' } }, 409);
  }

  const secret = generateTotpSecret();
  await context.env.DB.batch([
    context.env.DB.prepare(`INSERT INTO user_mfa (user_id, secret, confirmed_at, last_used_step, recovery_codes_json)
      VALUES (?, ?, NULL, NULL, '[]')
      ON CONFLICT(user_id) DO UPDATE SET secret = excluded.secret, confirmed_at = NULL,
        last_used_step = NULL, recovery_codes_json = '[]', updated_at = unixepoch()`)
      .bind(user.id, secret),
    audit(context.env, user.id, 'account.mfa_setup_started', 'user', user.id),
  ]);

  return context.json({
    ok: true,
    data: {
      secret,
      otpauthUri: otpauthUri(secret, user.email),
      issuer: 'CERBERUS Workspace',
      account: user.email,
      digits: 6,
      period: 30,
    },
  });
});

accountRoutes.post('/mfa/confirm', async (context) => {
  const user = context.get('user');
  const parsed = mfaConfirmSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Enter the 6-digit authenticator code', fields: parsed.error.flatten().fieldErrors } }, 422);
  }
  if (!await consumeRateLimit(context.env, `account-mfa:${user.id}`, 20, 900)) {
    return context.json({ ok: false, error: { code: 'RATE_LIMITED', message: 'Too many security requests. Try again later.' } }, 429);
  }

  const row = await context.env.DB.prepare(`SELECT secret, confirmed_at FROM user_mfa WHERE user_id = ?`)
    .bind(user.id).first<{ secret: string; confirmed_at: number | null }>();
  if (!row) {
    return context.json({ ok: false, error: { code: 'MFA_SETUP_REQUIRED', message: 'Start authenticator setup before confirming a code' } }, 409);
  }
  if (row.confirmed_at) {
    return context.json({ ok: false, error: { code: 'MFA_ALREADY_ENABLED', message: 'Authenticator protection is already enabled' } }, 409);
  }

  const verification = await verifyTotp(row.secret, parsed.data.code);
  if (!verification.valid) {
    return context.json({ ok: false, error: { code: 'MFA_CODE_INVALID', message: 'That authenticator code is not valid' } }, 401);
  }

  // Confirmation proves the secret works but deliberately does not consume the
  // current step, so the first login can still use a code from this window.
  const recoveryCodes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
  const hashes = await Promise.all(recoveryCodes.map(hashRecoveryCode));
  await context.env.DB.batch([
    context.env.DB.prepare(`UPDATE user_mfa SET confirmed_at = unixepoch(), recovery_codes_json = ?, updated_at = unixepoch()
      WHERE user_id = ? AND confirmed_at IS NULL`).bind(JSON.stringify(hashes), user.id),
    audit(context.env, user.id, 'account.mfa_enabled', 'user', user.id, { recoveryCodes: recoveryCodes.length }),
  ]);

  return context.json({ ok: true, data: { enabled: true, recoveryCodes } });
});

accountRoutes.post('/mfa/disable', async (context) => {
  const user = context.get('user');
  const parsed = mfaDisableSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Confirm your password and a current verification code', fields: parsed.error.flatten().fieldErrors } }, 422);
  }
  if (!await consumeRateLimit(context.env, `account-mfa:${user.id}`, 20, 900)) {
    return context.json({ ok: false, error: { code: 'RATE_LIMITED', message: 'Too many security requests. Try again later.' } }, 429);
  }

  const password = await context.env.DB.prepare(`SELECT password_hash FROM users WHERE id = ?`)
    .bind(user.id).first<{ password_hash: string | null }>();
  if (!password?.password_hash || !await verifyPassword(parsed.data.password, password.password_hash)) {
    return context.json({ ok: false, error: { code: 'CURRENT_PASSWORD_INVALID', message: 'The current password is incorrect' } }, 401);
  }
  const row = await context.env.DB.prepare(`SELECT secret, confirmed_at, recovery_codes_json FROM user_mfa WHERE user_id = ?`)
    .bind(user.id).first<{ secret: string; confirmed_at: number | null; recovery_codes_json: string }>();
  if (!row?.confirmed_at) {
    return context.json({ ok: false, error: { code: 'MFA_NOT_ENABLED', message: 'Authenticator protection is not enabled' } }, 409);
  }

  const code = await verifyTotp(row.secret, parsed.data.code);
  const recoveryIndex = code.valid ? -1 : await matchRecoveryCode(parsed.data.code, parseRecoveryHashes(row.recovery_codes_json));
  if (!code.valid && recoveryIndex < 0) {
    return context.json({ ok: false, error: { code: 'MFA_CODE_INVALID', message: 'That verification code is not valid' } }, 401);
  }

  await context.env.DB.batch([
    context.env.DB.prepare(`DELETE FROM user_mfa WHERE user_id = ?`).bind(user.id),
    context.env.DB.prepare(`DELETE FROM login_challenges WHERE user_id = ?`).bind(user.id),
    context.env.DB.prepare(`UPDATE sessions SET revoked_at = unixepoch()
      WHERE user_id = ? AND id <> ? AND revoked_at IS NULL`).bind(user.id, context.get('sessionId')),
    audit(context.env, user.id, 'account.mfa_disabled', 'user', user.id, {
      method: code.valid ? 'totp' : 'recovery_code',
    }),
  ]);

  return context.json({ ok: true, data: { enabled: false } });
});

accountRoutes.post('/mfa/recovery-codes', async (context) => {
  const user = context.get('user');
  const parsed = mfaDisableSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Confirm your password and a current verification code', fields: parsed.error.flatten().fieldErrors } }, 422);
  }
  if (!await consumeRateLimit(context.env, `account-mfa:${user.id}`, 20, 900)) {
    return context.json({ ok: false, error: { code: 'RATE_LIMITED', message: 'Too many security requests. Try again later.' } }, 429);
  }

  const password = await context.env.DB.prepare(`SELECT password_hash FROM users WHERE id = ?`)
    .bind(user.id).first<{ password_hash: string | null }>();
  if (!password?.password_hash || !await verifyPassword(parsed.data.password, password.password_hash)) {
    return context.json({ ok: false, error: { code: 'CURRENT_PASSWORD_INVALID', message: 'The current password is incorrect' } }, 401);
  }
  const row = await context.env.DB.prepare(`SELECT secret, confirmed_at, recovery_codes_json FROM user_mfa WHERE user_id = ?`)
    .bind(user.id).first<{ secret: string; confirmed_at: number | null; recovery_codes_json: string }>();
  if (!row?.confirmed_at) {
    return context.json({ ok: false, error: { code: 'MFA_NOT_ENABLED', message: 'Authenticator protection is not enabled' } }, 409);
  }

  const code = await verifyTotp(row.secret, parsed.data.code);
  const recoveryIndex = code.valid ? -1 : await matchRecoveryCode(parsed.data.code, parseRecoveryHashes(row.recovery_codes_json));
  if (!code.valid && recoveryIndex < 0) {
    return context.json({ ok: false, error: { code: 'MFA_CODE_INVALID', message: 'That verification code is not valid' } }, 401);
  }

  const recoveryCodes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
  const hashes = await Promise.all(recoveryCodes.map(hashRecoveryCode));
  await context.env.DB.batch([
    context.env.DB.prepare(`UPDATE user_mfa SET recovery_codes_json = ?, updated_at = unixepoch() WHERE user_id = ?`)
      .bind(JSON.stringify(hashes), user.id),
    audit(context.env, user.id, 'account.mfa_recovery_codes_regenerated', 'user', user.id, {
      count: recoveryCodes.length,
    }),
  ]);

  return context.json({ ok: true, data: { recoveryCodes } });
});
