import type { Env } from '../types';

export const DEFAULT_IDLE_MINUTES = 480;
const MIN_IDLE_MINUTES = 5;
const MAX_IDLE_MINUTES = 10_080;

/** Sessions are touched at most once per minute to avoid a write per request. */
export const SESSION_TOUCH_SECONDS = 60;

/** A password-verified login must complete its MFA step within five minutes. */
export const MFA_CHALLENGE_SECONDS = 5 * 60;
export const MFA_CHALLENGE_MAX_ATTEMPTS = 10;

export type LoginMethod = 'password' | 'mfa' | 'recovery_code';

export function idleTimeoutMinutes(env: Pick<Env, 'SESSION_IDLE_MINUTES'>): number {
  const configured = Number(env.SESSION_IDLE_MINUTES);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_IDLE_MINUTES;
  return Math.min(MAX_IDLE_MINUTES, Math.max(MIN_IDLE_MINUTES, Math.round(configured)));
}

export function idleTimeoutSeconds(env: Pick<Env, 'SESSION_IDLE_MINUTES'>): number {
  return idleTimeoutMinutes(env) * 60;
}

export function isIdleExpired(lastSeenAt: number, now: number, idleSeconds: number): boolean {
  return now - lastSeenAt > idleSeconds;
}

export function shouldTouchSession(lastSeenAt: number, now: number): boolean {
  return now - lastSeenAt >= SESSION_TOUCH_SECONDS;
}

export interface LoginEventInput {
  userId: string;
  success: boolean;
  method: LoginMethod;
  reason?: string | null;
  ipHash?: string | null;
  userAgent?: string | null;
}

/**
 * Append-only authentication ledger. Failures are recorded for known accounts so
 * members and administrators can spot credential stuffing or replay attempts.
 */
export async function recordLoginEvent(env: Env, input: LoginEventInput): Promise<void> {
  await env.DB.prepare(`INSERT INTO login_events (id, user_id, success, method, reason, ip_hash, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      crypto.randomUUID(),
      input.userId,
      input.success ? 1 : 0,
      input.method,
      input.reason ?? null,
      input.ipHash ?? null,
      input.userAgent ?? null,
    )
    .run();
}
