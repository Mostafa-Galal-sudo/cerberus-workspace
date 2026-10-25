import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Env, Variables } from '../types';
import { sha256, timingSafeCompare } from '../services/security';
import { idleTimeoutSeconds, isIdleExpired, shouldTouchSession } from '../services/session-security';

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

export const requireAuth: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (context, next) => {
  const production = context.env.APP_ENV === 'production';
  const token = getCookie(context, '__Host-cerberus_session')
    ?? (production ? undefined : getCookie(context, 'cerberus_session'));
  if (!token) return context.json({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } }, 401);
  const tokenHash = await sha256(token);
  const session = await context.env.DB.prepare(`SELECT s.id, s.user_id, s.csrf_token, s.expires_at, s.last_seen_at,
      u.email, u.display_name, u.specialization, u.status, u.must_change_password, u.archived_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > unixepoch()`).bind(tokenHash).first<{
      id: string; user_id: string; csrf_token: string; expires_at: number; last_seen_at: number; email: string;
      display_name: string; specialization: string | null; status: string; must_change_password: number;
      archived_at: number | null;
    }>();
  if (!session || session.status !== 'active' || session.archived_at !== null) {
    return context.json({ ok: false, error: { code: 'SESSION_EXPIRED', message: 'Session expired' } }, 401);
  }
  const now = Math.floor(Date.now() / 1000);
  if (isIdleExpired(session.last_seen_at, now, idleTimeoutSeconds(context.env))) {
    await context.env.DB.prepare(`UPDATE sessions SET revoked_at = unixepoch() WHERE id = ? AND revoked_at IS NULL`)
      .bind(session.id).run();
    return context.json({ ok: false, error: { code: 'SESSION_IDLE_TIMEOUT', message: 'Session locked after inactivity. Sign in again.' } }, 401);
  }
  const access = await context.env.DB.prepare(`SELECT DISTINCT r.name AS role, p.name AS permission
    FROM user_roles ur JOIN roles r ON r.id = ur.role_id
    LEFT JOIN role_permissions rp ON rp.role_id = r.id LEFT JOIN permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = ?`).bind(session.user_id).all<{ role: string; permission: string | null }>();
  context.set('user', {
    id: session.user_id, email: session.email, displayName: session.display_name,
    specialization: session.specialization,
    roles: [...new Set(access.results.map((row) => row.role))],
    permissions: [...new Set(access.results.flatMap((row) => row.permission ? [row.permission] : []))],
    mustChangePassword: session.must_change_password === 1,
  });
  context.set('sessionId', session.id);
  context.set('csrfToken', session.csrf_token);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(context.req.method)) {
    const supplied = context.req.header('X-CSRF-Token');
    if (!supplied || !timingSafeCompare(supplied, session.csrf_token)) {
      return context.json({ ok: false, error: { code: 'CSRF_INVALID', message: 'Request verification failed' } }, 403);
    }
  }
  if (shouldTouchSession(session.last_seen_at, now)) {
    await context.env.DB.prepare(`UPDATE sessions SET last_seen_at = unixepoch() WHERE id = ? AND revoked_at IS NULL`)
      .bind(session.id).run();
  }
  await next();
};

export const requirePasswordChanged: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (context, next) => {
  if (context.get('user').mustChangePassword) {
    return context.json({ ok: false, error: { code: 'PASSWORD_CHANGE_REQUIRED', message: 'Change the temporary password before accessing the workspace' } }, 403);
  }
  await next();
};

export function requirePermission(permission: string): MiddlewareHandler<{ Bindings: Env; Variables: Variables }> {
  return async (context, next) => {
    if (!context.get('user').permissions.includes(permission)) {
      return context.json({ ok: false, error: { code: 'FORBIDDEN', message: 'You do not have permission for this action' } }, 403);
    }
    await next();
  };
}

export function requireRole(...roles: string[]): MiddlewareHandler<{ Bindings: Env; Variables: Variables }> {
  return async (context, next) => {
    if (!context.get('user').roles.some((role) => roles.includes(role))) {
      return context.json({ ok: false, error: { code: 'FORBIDDEN', message: 'This workspace mode cannot access that resource' } }, 403);
    }
    await next();
  };
}

export function currentUser(context: AppContext) { return context.get('user'); }
