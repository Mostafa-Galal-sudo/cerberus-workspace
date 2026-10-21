import { Hono, type Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { activationSchema, changePasswordSchema, loginSchema, passwordResetSchema, requestPasswordResetSchema } from '../../shared/schemas/auth';
import type { Env, Variables } from '../types';
import { requireAuth } from '../middleware/auth';
import { audit } from '../services/audit';
import { emailDeliveryConfigured, sendEmail } from '../services/email';
import { workspaceEventStatements } from '../services/events';
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

authRoutes.post('/request-password-reset', async (context) => {
  const parsed = requestPasswordResetSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Enter a valid email address' } }, 422);
  }

  const address = context.req.header('CF-Connecting-IP') ?? 'local';
  const rateKey = await sha256(`reset-request:${address}`);
  const recent = await context.env.DB.prepare(`SELECT COUNT(*) AS count FROM login_attempts WHERE key_hash=? AND attempted_at > unixepoch() - 900`)
    .bind(rateKey).first<{ count: number }>();
  if ((recent?.count ?? 0) >= 5) {
    return context.json({ ok: false, error: { code: 'RATE_LIMITED', message: 'Too many recovery requests. Try again later.' } }, 429);
  }
  await context.env.DB.prepare(`INSERT INTO login_attempts (key_hash, succeeded) VALUES (?, 0)`).bind(rateKey).run();

  const deliveryConfigured = emailDeliveryConfigured(context.env);
  let delivery: 'email' | 'administrator' = deliveryConfigured ? 'email' : 'administrator';

  const user = await context.env.DB.prepare(`SELECT id, email, display_name FROM users
    WHERE email=? COLLATE NOCASE AND status='active' AND archived_at IS NULL`)
    .bind(parsed.data.email).first<{ id: string; email: string; display_name: string }>();

  if (user) {
    const token = randomToken(32);
    const tokenHash = await sha256(token);
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const resetId = crypto.randomUUID();
    const baseUrl = (context.env.APP_ORIGIN ?? new URL(context.req.url).origin).replace(/\/+$/, '');
    const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;

    await context.env.DB.batch([
      context.env.DB.prepare(`UPDATE password_reset_tokens SET used_at=unixepoch() WHERE user_id=? AND used_at IS NULL`).bind(user.id),
      context.env.DB.prepare(`INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)`)
        .bind(resetId, user.id, tokenHash, expiresAt),
      audit(context.env, user.id, 'account.password_reset_requested', 'user', user.id, { resetId }),
    ]);

    let result = { sent: false, provider: 'none', reason: 'not_configured' } as Awaited<ReturnType<typeof sendEmail>>;
    if (deliveryConfigured) {
      result = await sendEmail(context.env, {
        to: user.email,
        subject: 'CERBERUS workspace password reset',
        text: `Hello ${user.display_name},\n\nA password reset was requested for your CERBERUS workspace account.\n\nUse this one-time link within one hour:\n${resetUrl}\n\nIf you did not request this reset, ignore this email. Your current password remains active.\n`,
      });
      if (!result.sent) delivery = 'administrator';
    }

    if (!result.sent) {
      const admins = await context.env.DB.prepare(`SELECT DISTINCT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id
        WHERE ur.role_id='role_admin' AND u.status='active' AND u.archived_at IS NULL`).all<{ id: string }>();
      const notificationStatements = admins.results.map((admin) =>
        context.env.DB.prepare(`INSERT INTO notifications (id, user_id, type, title, body, resource_type, resource_id)
          VALUES (?, ?, 'password.reset_requested', 'Password reset requested', ?, 'user', ?)`)
          .bind(crypto.randomUUID(), admin.id, `${user.display_name} (${user.email}) requested a password reset. Issue a one-time link from the member directory.`, user.id),
      );
      await context.env.DB.batch([
        ...notificationStatements,
        ...workspaceEventStatements(context.env, {
          type: 'password.reset_requested',
          userIds: admins.results.map((admin) => admin.id),
          payload: { userId: user.id, email: user.email },
        }),
      ]);
    }
  }

  return context.json({ ok: true, data: { requested: true, delivery } }, 202);
});

authRoutes.post('/reset-password', async (context) => {
  const parsed = passwordResetSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'The new password does not meet the security requirements', fields: parsed.error.flatten().fieldErrors } }, 422);
  }

  const address = context.req.header('CF-Connecting-IP') ?? 'local';
  const rateKey = await sha256(`reset:${address}`);
  const recent = await context.env.DB.prepare(`SELECT COUNT(*) AS count FROM login_attempts WHERE key_hash = ? AND succeeded = 0 AND attempted_at > unixepoch() - 900`)
    .bind(rateKey).first<{ count: number }>();
  if ((recent?.count ?? 0) >= 10) return context.json({ ok: false, error: { code: 'RATE_LIMITED', message: 'Too many reset attempts. Try again later.' } }, 429);

  const tokenHash = await sha256(parsed.data.token);
  const reset = await context.env.DB.prepare(`SELECT pr.id, pr.user_id, u.status
    FROM password_reset_tokens pr JOIN users u ON u.id = pr.user_id
    WHERE pr.token_hash = ? AND pr.used_at IS NULL AND pr.expires_at > unixepoch()`)
    .bind(tokenHash).first<{ id: string; user_id: string; status: string }>();
  const valid = Boolean(reset && reset.status === 'active');
  await context.env.DB.prepare(`INSERT INTO login_attempts (key_hash, succeeded) VALUES (?, ?)`).bind(rateKey, valid ? 1 : 0).run();
  if (!valid || !reset) return context.json({ ok: false, error: { code: 'RESET_TOKEN_INVALID', message: 'This reset link is invalid, expired, or already used' } }, 400);

  const passwordHash = await hashPassword(parsed.data.password);
  await context.env.DB.batch([
    context.env.DB.prepare(`UPDATE users SET password_hash = ?, must_change_password = 0, status = 'active', updated_at = unixepoch() WHERE id = ?`).bind(passwordHash, reset.user_id),
    context.env.DB.prepare(`UPDATE password_reset_tokens SET used_at = unixepoch() WHERE id = ?`).bind(reset.id),
    context.env.DB.prepare(`UPDATE password_reset_tokens SET used_at = unixepoch() WHERE user_id = ? AND used_at IS NULL`).bind(reset.user_id),
    context.env.DB.prepare(`UPDATE sessions SET revoked_at = unixepoch() WHERE user_id = ? AND revoked_at IS NULL`).bind(reset.user_id),
    audit(context.env, reset.user_id, 'account.password_reset_completed', 'user', reset.user_id),
  ]);

  return context.json({ ok: true, data: { reset: true } });
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
