import type { Env } from '../types';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailResult {
  sent: boolean;
  provider: string;
  reason?: string;
  messageId?: string;
}

export function emailDeliveryConfigured(env: Env): boolean {
  const provider = (env.EMAIL_PROVIDER ?? '').toLowerCase();
  if (provider === 'resend') return Boolean(env.EMAIL_API_KEY && env.EMAIL_FROM);
  if (provider === 'cloudflare') return Boolean(env.EMAIL && env.EMAIL_FROM);
  return false;
}

async function recordOutbox(env: Env, message: EmailMessage, provider: string, status: 'sent' | 'failed' | 'skipped', error?: string): Promise<void> {
  try {
    await env.DB.prepare(`INSERT INTO email_outbox (id, recipient, subject, provider, status, error) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), message.to, message.subject.slice(0, 300), provider, status, error?.slice(0, 500) ?? null)
      .run();
  } catch (cause) {
    console.error(JSON.stringify({ level: 'error', service: 'email_outbox', message: cause instanceof Error ? cause.message : 'unknown' }));
  }
}

/**
 * Sends transactional mail through an explicitly configured provider.
 * When no provider is configured the operation is recorded as skipped and the
 * caller can fall back to an administrator-issued reset link.
 */
export async function sendEmail(env: Env, message: EmailMessage): Promise<EmailResult> {
  const provider = (env.EMAIL_PROVIDER ?? '').toLowerCase();

  if (provider === 'resend' && env.EMAIL_API_KEY && env.EMAIL_FROM) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.EMAIL_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: env.EMAIL_FROM,
          to: [message.to],
          subject: message.subject,
          text: message.text,
        }),
      });
      const body = await response.text();
      if (!response.ok) {
        throw new Error(`Resend rejected the message (${response.status}): ${body.slice(0, 300)}`);
      }
      let messageId: string | undefined;
      try {
        messageId = (JSON.parse(body) as { id?: string }).id;
      } catch {
        messageId = undefined;
      }
      await recordOutbox(env, message, 'resend', 'sent');
      return { sent: true, provider: 'resend', messageId };
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : 'Email provider failed';
      await recordOutbox(env, message, 'resend', 'failed', error);
      return { sent: false, provider: 'resend', reason: error };
    }
  }

  if (provider === 'cloudflare' && env.EMAIL && env.EMAIL_FROM) {
    try {
      await env.EMAIL.send({
        to: message.to,
        from: env.EMAIL_FROM,
        subject: message.subject,
        text: message.text,
      });
      await recordOutbox(env, message, 'cloudflare', 'sent');
      return { sent: true, provider: 'cloudflare' };
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : 'Email binding failed';
      await recordOutbox(env, message, 'cloudflare', 'failed', error);
      return { sent: false, provider: 'cloudflare', reason: error };
    }
  }

  await recordOutbox(env, message, provider || 'none', 'skipped', 'No email provider configured');
  return { sent: false, provider: provider || 'none', reason: 'not_configured' };
}
