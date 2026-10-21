import { beforeAll, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { computeHmacSha256, sha256 } from '../../worker/services/security';
import {
  ADMIN_EMAIL,
  MEMBER_EMAIL,
  call,
  login,
  readBody,
  readData,
  seedUsers,
  type Session,
} from './helpers';

describe('GitHub integration, administration and assistant telemetry', () => {
  const webhookSecret = 'integration-webhook-secret-2026';
  let admin: Session;

  beforeAll(async () => {
    await seedUsers();
    admin = await login(ADMIN_EMAIL);
  });

  it('configures GitHub, verifies webhook signatures and links task references', async () => {
    const settings = await call(admin, '/api/v1/github/settings', {
      method: 'POST',
      body: JSON.stringify({
        enabled: true,
        repository: 'Mostafa-Galal-sudo/cerberus-workspace',
        syncBranch: 'main',
        webhookSecret,
      }),
    });
    expect(settings.status).toBe(200);

    const payload = JSON.stringify({
      ref: 'refs/heads/main',
      commits: [{
        id: 'abc1234',
        message: 'feat(firmware): implement telemetry for task_1_1',
        url: 'https://github.com/Mostafa-Galal-sudo/cerberus-workspace/commit/abc1234',
      }],
    });
    const signature = await computeHmacSha256(webhookSecret, payload);

    const accepted = await call(null, '/api/v1/github/webhook', {
      method: 'POST',
      headers: {
        'x-github-event': 'push',
        'x-github-delivery': 'delivery-integration-1',
        'x-hub-signature-256': `sha256=${signature}`,
      },
      body: payload,
    });
    expect(accepted.status).toBe(200);

    const rejected = await call(null, '/api/v1/github/webhook', {
      method: 'POST',
      headers: {
        'x-github-event': 'push',
        'x-github-delivery': 'delivery-integration-2',
        'x-hub-signature-256': `sha256=${'0'.repeat(64)}`,
      },
      body: payload,
    });
    expect(rejected.status).toBe(401);
    expect((await readBody(rejected)).error?.code).toBe('SIGNATURE_MISMATCH');

    const missing = await call(null, '/api/v1/github/webhook', {
      method: 'POST',
      headers: { 'x-github-event': 'push', 'x-github-delivery': 'delivery-integration-3' },
      body: payload,
    });
    expect(missing.status).toBe(401);

    const status = await call(admin, '/api/v1/github/status');
    expect(status.status).toBe(200);
    const data = await readData<{
      enabled: boolean;
      hasSecret: boolean;
      events: Array<{ deliveryId: string; eventType: string }>;
      links: Array<{ resource_id: string; github_type: string }>;
    }>(status);
    expect(data.enabled).toBe(true);
    expect(data.hasSecret).toBe(true);
    expect(data.events.some((event) => event.deliveryId === 'delivery-integration-1')).toBe(true);
    expect(data.events.some((event) => event.deliveryId === 'delivery-integration-2')).toBe(false);
    expect(data.links.some((link) => link.resource_id === 'task_1_1' && link.github_type === 'commit')).toBe(true);
  });

  it('records simulated GitHub events without external calls', async () => {
    const simulated = await call(admin, '/api/v1/github/simulate-event', {
      method: 'POST',
      body: JSON.stringify({ eventType: 'push', taskId: 'task_1_2', commitMessage: 'feat: wire task_1_2 telemetry' }),
    });
    expect(simulated.status).toBe(201);

    const data = await readData<{ deliveryId: string; taskId: string; linked: boolean }>(simulated);
    expect(data.taskId).toBe('task_1_2');
    expect(data.linked).toBe(true);

    const status = await call(admin, '/api/v1/github/status');
    const payload = await readBody<{ events: Array<{ deliveryId: string }>; links: Array<{ resource_id: string }> }>(status);
    expect(payload.data.events.some((event) => event.deliveryId === data.deliveryId)).toBe(true);
    expect(payload.data.links.some((link) => link.resource_id === 'task_1_2')).toBe(true);
  });

  it('exports a checksummed backup and verifies restore payload integrity', async () => {
    const exported = await call(admin, '/api/v1/admin/backup/export');
    expect(exported.status).toBe(200);

    const data = await readData<{
      checksum: string;
      totalRecords: number;
      payload: { version: string; exportedAt: number; tables: Record<string, unknown[]> };
    }>(exported);

    expect(data.checksum).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(data.totalRecords).toBeGreaterThan(0);
    expect(await sha256(JSON.stringify(data.payload))).toBe(data.checksum);
    expect(data.payload.tables.users.length).toBe(5);

    const restore = await call(admin, '/api/v1/admin/backup/restore', {
      method: 'POST',
      body: JSON.stringify({ payload: data.payload, checksum: data.checksum }),
    });
    expect(restore.status).toBe(200);
    const verification = await readData<{ verified: boolean; restored: boolean }>(restore);
    expect(verification.verified).toBe(true);
    expect(verification.restored).toBe(false);

    const tampered = await call(admin, '/api/v1/admin/backup/restore', {
      method: 'POST',
      body: JSON.stringify({ payload: data.payload, checksum: 'f'.repeat(64) }),
    });
    expect(tampered.status).toBe(400);
    expect((await readBody(tampered)).error?.code).toBe('CHECKSUM_MISMATCH');

    const missingChecksum = await call(admin, '/api/v1/admin/backup/restore', {
      method: 'POST',
      body: JSON.stringify({ payload: data.payload }),
    });
    expect(missingChecksum.status).toBe(400);
    expect((await readBody(missingChecksum)).error?.code).toBe('CHECKSUM_REQUIRED');

    const operations = await env.DB.prepare(`SELECT operation, COUNT(*) AS count FROM backup_runs GROUP BY operation`).all<{ operation: string; count: number }>();
    const byOperation = new Map(operations.results.map((row) => [row.operation, row.count]));
    expect(byOperation.get('export')).toBe(1);
    expect(byOperation.get('restore')).toBe(1);
  });

  it('serves administrative metrics, audit records and workspace settings', async () => {
    const metrics = await call(admin, '/api/v1/admin/metrics');
    expect(metrics.status).toBe(200);
    const data = await readData<{ users: number; tasks: number; auditLogs: number }>(metrics);
    expect(data.users).toBe(5);
    expect(data.auditLogs).toBeGreaterThan(0);

    const audit = await call(admin, '/api/v1/admin/audit-logs?limit=10');
    expect(audit.status).toBe(200);
    expect((await readBody(audit)).data.length).toBeGreaterThan(0);

    const update = await call(admin, '/api/v1/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify({ 'workspace.reviewPolicy': 'two-person' }),
    });
    expect(update.status).toBe(200);

    const settings = await call(admin, '/api/v1/admin/settings');
    const values = await readData<Record<string, unknown>>(settings);
    expect(values['workspace.reviewPolicy']).toBe('two-person');
  });

  it('answers assistant prompts from live workspace context and records usage telemetry', async () => {
    const member = await login(MEMBER_EMAIL);
    const chat = await call(member, '/api/v1/assistant/chat', {
      method: 'POST',
      body: JSON.stringify({ message: 'What is the current task status across the workspace?' }),
    });
    expect(chat.status).toBe(200);
    const reply = await readData<{ reply: string; sources: unknown[]; usageId: string }>(chat);
    expect(reply.reply).toContain('task ledger status');
    expect(reply.usageId).toBeTruthy();

    const usage = await call(member, '/api/v1/assistant/usage');
    expect(usage.status).toBe(200);
    const rows = await readData<Array<{ id: string; model: string; status: string }>>(usage);
    expect(rows.some((row) => row.id === reply.usageId && row.status === 'completed')).toBe(true);
  });
});
