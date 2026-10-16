import { Hono, type Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { activationSchema, changePasswordSchema, loginSchema } from '../../shared/schemas/auth';
import type { Env, Variables } from '../types';
import { requireAuth } from '../middleware/auth';
import { audit } from '../services/audit';
import { hashPassword, randomToken, sha256, verifyPassword } from '../services/security';

export const authRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
const sessionSeconds = 60 * 60 * 24 * 7;

authRoutes.post('/activate', async (context) => {
  const parsed = activationSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid activation details', fields: parsed.error.flatten().fieldErrors } }, 422);
  const tokenHash = await sha256(parsed.data.token);
  const invitation = await context.env.DB.prepare(`SELECT i.id, i.user_id, u.status FROM invitations i JOIN users u ON u.id = i.user_id
    WHERE i.token_hash = ? AND i.accepted_at IS NULL AND i.expires_at > unixepoch()`).bind(tokenHash).first<{ id: string; user_id: string; status: string }>();
  if (!invitation || invitation.status === 'suspended') return context.json({ ok: false, error: { code: 'INVITATION_INVALID', message: 'Invitation is invalid or expired' } }, 400);
  const passwordHash = await hashPassword(parsed.data.password);
  await context.env.DB.batch([
    context.env.DB.prepare(`UPDATE users SET password_hash = ?, status = 'active', must_change_password = 0, updated_at = unixepoch() WHERE id = ?`).bind(passwordHash, invitation.user_id),
    context.env.DB.prepare(`UPDATE invitations SET accepted_at = unixepoch() WHERE id = ?`).bind(invitation.id),
    audit(context.env, invitation.user_id, 'account.activated', 'user', invitation.user_id),
  ]);
  return createSession(context, invitation.user_id, false, 201);
});

authRoutes.post('/login', async (context) => {
  const parsed = loginSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) return context.json({ ok: false, error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' } }, 401);
  const address = context.req.header('CF-Connecting-IP') ?? 'local';
  const rateKey = await sha256(`${address}:${parsed.data.email.toLowerCase()}`);
  const recent = await context.env.DB.prepare(`SELECT COUNT(*) AS count FROM login_attempts WHERE key_hash = ? AND succeeded = 0 AND attempted_at > unixepoch() - 900`)
    .bind(rateKey).first<{ count: number }>();
  if ((recent?.count ?? 0) >= 8) return context.json({ ok: false, error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' } }, 429);
  const user = await context.env.DB.prepare(`SELECT id, password_hash, status, must_change_password FROM users WHERE email = ? COLLATE NOCASE`).bind(parsed.data.email).first<{ id: string; password_hash: string | null; status: string; must_change_password: number }>();
  const valid = Boolean(user?.password_hash && user.status === 'active' && await verifyPassword(parsed.data.password, user.password_hash));
  await context.env.DB.prepare(`INSERT INTO login_attempts (key_hash, succeeded) VALUES (?, ?)` ).bind(rateKey, valid ? 1 : 0).run();
  if (!valid || !user) return context.json({ ok: false, error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' } }, 401);
  return createSession(context, user.id, user.must_change_password === 1, 200);
});

authRoutes.use('/me', requireAuth);
authRoutes.get('/me', (context) => context.json({ ok: true, data: { user: context.get('user'), csrfToken: context.get('csrfToken') } }));

authRoutes.use('/change-password', requireAuth);
authRoutes.post('/change-password', async (context) => {
  const parsed = changePasswordSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'The new password does not meet the security requirements', fields: parsed.error.flatten().fieldErrors } }, 422);
  }
  const user = await context.env.DB.prepare(`SELECT password_hash FROM users WHERE id = ? AND status = 'active'`)
    .bind(context.get('user').id).first<{ password_hash: string | null }>();
  if (!user?.password_hash || !await verifyPassword(parsed.data.currentPassword, user.password_hash)) {
    return context.json({ ok: false, error: { code: 'CURRENT_PASSWORD_INVALID', message: 'The temporary password is incorrect' } }, 401);
  }
  const passwordHash = await hashPassword(parsed.data.newPassword);
  await context.env.DB.batch([
    context.env.DB.prepare(`UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = unixepoch() WHERE id = ?`)
      .bind(passwordHash, context.get('user').id),
    context.env.DB.prepare(`UPDATE sessions SET revoked_at = unixepoch() WHERE user_id = ? AND id <> ? AND revoked_at IS NULL`)
      .bind(context.get('user').id, context.get('sessionId')),
    audit(context.env, context.get('user').id, 'account.password_changed', 'user', context.get('user').id),
  ]);
  return context.json({ ok: true, data: { mustChangePassword: false } });
});

authRoutes.use('/logout', requireAuth);
authRoutes.post('/logout', async (context) => {
  await context.env.DB.batch([
    context.env.DB.prepare(`UPDATE sessions SET revoked_at = unixepoch() WHERE id = ?`).bind(context.get('sessionId')),
    audit(context.env, context.get('user').id, 'session.logout', 'session', context.get('sessionId')),
  ]);
  const production = new URL(context.req.url).protocol === 'https:';
  deleteCookie(context, production ? '__Host-cerberus_session' : 'cerberus_session', {
    path: '/', secure: production, httpOnly: true, sameSite: 'Strict',
  });
  return context.json({ ok: true, data: null });
});

async function createSession(context: Context<{ Bindings: Env; Variables: Variables }>, userId: string, mustChangePassword: boolean, status: 200 | 201) {
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const sessionId = crypto.randomUUID();
  const ipHash = await sha256(context.req.header('CF-Connecting-IP') ?? 'local');
  await context.env.DB.batch([
    context.env.DB.prepare(`INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at, user_agent, ip_hash)
      VALUES (?, ?, ?, ?, unixepoch() + ?, ?, ?)`).bind(sessionId, userId, await sha256(token), csrfToken, sessionSeconds, context.req.header('User-Agent') ?? null, ipHash),
    context.env.DB.prepare(`UPDATE users SET last_activity_at = unixepoch() WHERE id = ?`).bind(userId),
    audit(context.env, userId, 'session.created', 'session', sessionId),
  ]);
  const production = new URL(context.req.url).protocol === 'https:';
  setCookie(context, production ? '__Host-cerberus_session' : 'cerberus_session', token, {
    httpOnly: true, secure: production, sameSite: 'Strict', path: '/', maxAge: sessionSeconds,
  });
  return context.json({ ok: true, data: { csrfToken, mustChangePassword } }, status);
}
