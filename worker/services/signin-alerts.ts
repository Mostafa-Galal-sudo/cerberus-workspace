import type { Env } from '../types';
import { emailDeliveryConfigured, sendEmail } from './email';
import { categoryPrefersEmail, readNotificationPreferences } from './notifications';

export interface SigninAlertInput {
  userId: string;
  ipHash: string;
  userAgent: string | null;
  method: 'password' | 'mfa' | 'recovery_code';
}

export type SigninAlertOutcome = 'notified' | 'skipped' | 'failed';

/**
 * Raises an in-app (and, when a provider is configured, email) alert when a
 * completed sign-in comes from a different network than the previous one.
 *
 * The caller must invoke this before writing the current login event so the
 * query sees the previous completed sign-in. Failures never block the login.
 */
export async function alertNewSignin(env: Env, input: SigninAlertInput): Promise<SigninAlertOutcome> {
  try {
    const previous = await env.DB.prepare(`SELECT ip_hash AS ipHash FROM login_events
      WHERE user_id = ? AND success = 1 AND (reason IS NULL OR reason <> 'mfa_required')
      ORDER BY created_at DESC, rowid DESC LIMIT 1`).bind(input.userId).first<{ ipHash: string | null }>();

    if (!previous?.ipHash || previous.ipHash === input.ipHash) return 'skipped';

    const fingerprint = input.ipHash.slice(0, 10);
    const signedInAt = new Date().toUTCString();
    const agent = (input.userAgent ?? 'Unknown client').slice(0, 120);
    const methodLabel = input.method === 'recovery_code'
      ? 'a recovery code'
      : input.method === 'mfa' ? 'a password and authenticator code' : 'a password';
    const body = `A sign-in from a new network was recorded on ${signedInAt} using ${methodLabel}. Client: ${agent}. Network fingerprint: ${fingerprint}. If this was not you, change your password and revoke the other sessions from Account security.`;

    await env.DB.prepare(`INSERT INTO notifications (id, user_id, type, title, body, resource_type, resource_id)
      VALUES (?, ?, 'auth.new_signin', 'New sign-in to your account', ?, 'user', ?)`)
      .bind(crypto.randomUUID(), input.userId, body, input.userId).run();

    if (!emailDeliveryConfigured(env)) return 'notified';

    const recipient = await env.DB.prepare(`SELECT email, display_name AS displayName FROM users WHERE id = ?`)
      .bind(input.userId).first<{ email: string; displayName: string }>();
    if (!recipient) return 'notified';
    const preferences = await readNotificationPreferences(env.DB, input.userId);
    if (!categoryPrefersEmail(preferences.categories, 'account')) return 'notified';

    const result = await sendEmail(env, {
      to: recipient.email,
      subject: 'New sign-in to your CERBERUS workspace account',
      text: `Hello ${recipient.displayName},\n\n${body}\n\nIf this was you, no action is required.\n`,
    });
    return result.sent ? 'notified' : 'failed';
  } catch (cause) {
    console.error(JSON.stringify({
      level: 'error',
      service: 'signin-alerts',
      message: cause instanceof Error ? cause.message : 'unknown',
    }));
    return 'failed';
  }
}
