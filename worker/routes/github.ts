import { Hono } from 'hono';
import { requireAuth, requirePasswordChanged, requirePermission } from '../middleware/auth';
import { audit } from '../services/audit';
import type { Env, Variables } from '../types';

export const githubRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// Webhook receiver (unauthenticated because GitHub calls it, but HMAC signature verified!)
githubRoutes.post('/webhook', async (context) => {
  const deliveryId = context.req.header('X-GitHub-Delivery') ?? crypto.randomUUID();
  const eventType = context.req.header('X-GitHub-Event') ?? 'ping';
  const signature = context.req.header('X-Hub-Signature-256');

  const rawBody = await context.req.text();

  // Retrieve GitHub integration settings
  const settings = await context.env.DB.prepare(`SELECT enabled, config_json FROM integration_settings WHERE integration = 'github'`).first<{ enabled: number; config_json: string }>();
  const config = JSON.parse(settings?.config_json ?? '{}') as { webhookSecret?: string; repository?: string };

  // If a webhook secret is configured, verify HMAC-SHA256 signature
  if (config.webhookSecret) {
    if (!signature || !signature.startsWith('sha256=')) {
      return context.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Missing or malformed X-Hub-Signature-256' } }, 401);
    }
    const expected = await computeHmacSha256(config.webhookSecret, rawBody);
    const provided = signature.slice(7);
    if (!timingSafeCompare(expected, provided)) {
      return context.json({ ok: false, error: { code: 'SIGNATURE_MISMATCH', message: 'Invalid HMAC signature' } }, 401);
    }
  }

  // Parse payload
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return context.json({ ok: false, error: { code: 'INVALID_PAYLOAD', message: 'Invalid JSON payload' } }, 400);
  }

  const eventId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    context.env.DB.prepare(`INSERT INTO github_events (id, delivery_id, event_type, action, payload_json, processed_at)
      VALUES (?, ?, ?, ?, ?, unixepoch())`)
      .bind(eventId, deliveryId, eventType, typeof payload.action === 'string' ? payload.action : null, rawBody),
  ];

  // If push event with commits, extract any task references and link
  if (eventType === 'push' && Array.isArray(payload.commits)) {
    for (const commit of payload.commits as Array<{ id: string; message: string; url: string }>) {
      const taskMatches = commit.message.match(/task_[a-zA-Z0-9_-]+/g);
      if (taskMatches) {
        for (const taskId of taskMatches) {
          statements.push(context.env.DB.prepare(`INSERT OR IGNORE INTO github_links (id, project_id, resource_type, resource_id, github_type, github_id, url)
            VALUES (?, 'project_cerberus', 'task', ?, 'commit', ?, ?)`).bind(crypto.randomUUID(), taskId, commit.id, commit.url));
        }
      }
    }
  }

  // If pull_request event, link PR to task if mentioned in title or body
  if (eventType === 'pull_request' && payload.pull_request) {
    const pr = payload.pull_request as { id: number; html_url: string; title: string; body?: string };
    const text = `${pr.title} ${pr.body ?? ''}`;
    const taskMatches = text.match(/task_[a-zA-Z0-9_-]+/g);
    if (taskMatches) {
      for (const taskId of taskMatches) {
        statements.push(context.env.DB.prepare(`INSERT OR IGNORE INTO github_links (id, project_id, resource_type, resource_id, github_type, github_id, url)
          VALUES (?, 'project_cerberus', 'task', ?, 'pull_request', ?, ?)`).bind(crypto.randomUUID(), taskId, String(pr.id), pr.html_url));
      }
    }
  }

  await context.env.DB.batch(statements);
  return context.json({ ok: true, data: { received: true, deliveryId, eventType } });
});

// Authenticated GitHub endpoints
githubRoutes.use('*', requireAuth, requirePasswordChanged);

githubRoutes.get('/status', async (context) => {
  const [settings, events, links] = await Promise.all([
    context.env.DB.prepare(`SELECT enabled, config_json, updated_at AS updatedAt FROM integration_settings WHERE integration = 'github'`).first<{ enabled: number; config_json: string; updatedAt: number }>(),
    context.env.DB.prepare(`SELECT id, delivery_id AS deliveryId, event_type AS eventType, action, received_at AS receivedAt,
      substr(payload_json, 1, 250) AS payloadExcerpt
      FROM github_events ORDER BY received_at DESC LIMIT 20`).all(),
    context.env.DB.prepare(`SELECT gl.*, t.title AS taskTitle FROM github_links gl
      LEFT JOIN tasks t ON t.id = gl.resource_id
      ORDER BY gl.created_at DESC LIMIT 30`).all(),
  ]);

  const config = JSON.parse(settings?.config_json ?? '{}') as { repository?: string; webhookSecret?: string; syncBranch?: string };

  return context.json({
    ok: true,
    data: {
      enabled: Boolean(settings?.enabled),
      repository: config.repository ?? 'Mostafa-Galal-sudo/cerberus-firmware',
      syncBranch: config.syncBranch ?? 'main',
      hasSecret: Boolean(config.webhookSecret),
      updatedAt: settings?.updatedAt,
      events: events.results,
      links: links.results,
    },
  });
});

githubRoutes.post('/settings', requirePermission('workspace.admin'), async (context) => {
  const body = await context.req.json<{ enabled?: boolean; repository?: string; webhookSecret?: string; syncBranch?: string }>().catch(() => ({} as { enabled?: boolean; repository?: string; webhookSecret?: string; syncBranch?: string }));
  const existing = await context.env.DB.prepare(`SELECT config_json FROM integration_settings WHERE integration = 'github'`).first<{ config_json: string }>();
  const currentConfig = JSON.parse(existing?.config_json ?? '{}') as Record<string, unknown>;

  const nextConfig = {
    ...currentConfig,
    repository: body.repository !== undefined ? body.repository.trim() : currentConfig.repository,
    syncBranch: body.syncBranch !== undefined ? body.syncBranch.trim() : currentConfig.syncBranch,
    ...(body.webhookSecret !== undefined ? { webhookSecret: body.webhookSecret } : {}),
  };

  const enabled = body.enabled !== undefined ? (body.enabled ? 1 : 0) : 1;

  await context.env.DB.batch([
    context.env.DB.prepare(`INSERT INTO integration_settings (integration, enabled, config_json, updated_by, updated_at)
      VALUES ('github', ?, ?, ?, unixepoch())
      ON CONFLICT(integration) DO UPDATE SET enabled=excluded.enabled, config_json=excluded.config_json, updated_by=excluded.updated_by, updated_at=unixepoch()`)
      .bind(enabled, JSON.stringify(nextConfig), context.get('user').id),
    audit(context.env, context.get('user').id, 'github.settings_updated', 'integration', 'github'),
  ]);

  return context.json({ ok: true, data: { enabled: Boolean(enabled), repository: nextConfig.repository } });
});

githubRoutes.post('/simulate-event', requirePermission('workspace.admin'), async (context) => {
  const body = await context.req.json<{ eventType?: string; taskId?: string; commitMessage?: string }>().catch(() => ({} as { eventType?: string; taskId?: string; commitMessage?: string }));
  const eventType = body.eventType ?? 'push';
  const taskId = body.taskId ?? 'task_1_1';
  const commitSha = crypto.randomUUID().replaceAll('-', '').slice(0, 7);
  const commitMessage = body.commitMessage ?? `feat(firmware): implement SPI telemetry transceiver for ${taskId}`;
  const commitUrl = `https://github.com/Mostafa-Galal-sudo/cerberus-firmware/commit/${commitSha}`;

  const eventPayload = {
    ref: 'refs/heads/main',
    repository: { full_name: 'Mostafa-Galal-sudo/cerberus-firmware' },
    commits: [{ id: commitSha, message: commitMessage, url: commitUrl }],
  };

  const eventId = crypto.randomUUID();
  const deliveryId = `sim_${crypto.randomUUID()}`;

  await context.env.DB.batch([
    context.env.DB.prepare(`INSERT INTO github_events (id, delivery_id, event_type, payload_json, processed_at)
      VALUES (?, ?, ?, ?, unixepoch())`)
      .bind(eventId, deliveryId, eventType, JSON.stringify(eventPayload)),
    context.env.DB.prepare(`INSERT OR IGNORE INTO github_links (id, project_id, resource_type, resource_id, github_type, github_id, url)
      VALUES (?, 'project_cerberus', 'task', ?, 'commit', ?, ?)`)
      .bind(crypto.randomUUID(), taskId, commitSha, commitUrl),
    audit(context.env, context.get('user').id, 'github.event_simulated', 'github_event', eventId),
  ]);

  return context.json({
    ok: true,
    data: {
      deliveryId,
      commitSha,
      taskId,
      commitUrl,
      linked: true,
    },
  }, 201);
});

async function computeHmacSha256(keyText: string, messageText: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(keyText), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(messageText));
  const hashArray = Array.from(new Uint8Array(signatureBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
