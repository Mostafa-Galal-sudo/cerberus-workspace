import { beforeAll, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import {
  ADMIN_EMAIL,
  MEMBER_EMAIL,
  MEMBER_ID,
  MEMBER_TWO_EMAIL,
  MEMBER_TWO_ID,
  SUPERVISOR_EMAIL,
  call,
  createTask,
  login,
  seedUsers,
  type Session,
} from './helpers';

describe('server-generated CSV reports', () => {
  let admin: Session;
  let member: Session;
  let memberTwo: Session;
  let supervisor: Session;

  beforeAll(async () => {
    await seedUsers();
    admin = await login(ADMIN_EMAIL);
    member = await login(MEMBER_EMAIL);
    memberTwo = await login(MEMBER_TWO_EMAIL);
    supervisor = await login(SUPERVISOR_EMAIL);

    await createTask(admin, { assigneeId: MEMBER_ID, title: 'Telemetry, "parser" regression verification' });
    await createTask(admin, { assigneeId: MEMBER_ID, title: '=HYPERLINK("https://example.test","open")' });
    await createTask(admin, { assigneeId: MEMBER_TWO_ID, title: 'Member two private report task' });

    await env.DB.prepare(`INSERT INTO hardware_items (id, name, model, serial_number, quantity, condition)
      VALUES ('hw_report_test', 'ESP32, DevKit V1', 'ESP32-WROOM-32', 'HW-REPORT-1', 4, 'good')`).run();
    await env.DB.prepare(`INSERT INTO blockers (id, project_id, reporter_id, title, description, severity, status)
      VALUES ('blocker_report_test', 'project_cerberus', ?, 'Reported blocker', 'Line one of the blocker description.\nLine two includes a comma, a quote " and more context.', 'high', 'open')`)
      .bind('user_test_admin').run();
  });

  it('requires authentication before exporting', async () => {
    const response = await call(null, '/api/v1/reports/tasks.csv');
    expect(response.status).toBe(401);
  });

  it('exports the full task register for administrators with CSV escaping', async () => {
    const response = await call(admin, '/api/v1/reports/tasks.csv');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toContain('cerberus-tasks-');

    const csv = await response.text();
    expect(csv.startsWith('id,title,status,priority,assignee,domain,checkpoint,created_utc,approved_utc\r\n')).toBe(true);
    expect(csv).toContain('"Telemetry, ""parser"" regression verification"');
    expect(csv).toContain('"\'=HYPERLINK(""https://example.test"",""open"")"');
    expect(csv).toContain('Member two private report task');
  });

  it('scopes member task exports to their own assignments', async () => {
    const csv = await (await call(member, '/api/v1/reports/tasks.csv')).text();
    expect(csv).toContain('Telemetry,');
    expect(csv).not.toContain('Member two private report task');

    const supervisorCsv = await (await call(supervisor, '/api/v1/reports/tasks.csv')).text();
    expect(supervisorCsv).toContain('Member two private report task');
  });

  it('exports roadmap progress with computed completion values', async () => {
    const response = await call(admin, '/api/v1/reports/progress.csv');
    expect(response.status).toBe(200);
    const csv = await response.text();
    expect(csv.startsWith('member,email,specialization,domain,total_tasks,approved_tasks,total_checkpoints,approved_checkpoints,task_progress_percent\r\n')).toBe(true);
    expect(csv).toContain('Member One');
    expect(csv).toContain('Member Two');
    expect(csv).toContain(',0\r\n');

    const denied = await call(memberTwo, '/api/v1/reports/progress.csv');
    expect(denied.status).toBe(403);
  });

  it('exports hardware inventory with holder state and blockers with escaped text', async () => {
    const hardware = await call(admin, '/api/v1/reports/hardware.csv');
    expect(hardware.status).toBe(200);
    const hardwareCsv = await hardware.text();
    expect(hardwareCsv).toContain('"ESP32, DevKit V1"');
    expect(hardwareCsv).toContain('Lab Available');

    const blockers = await call(admin, '/api/v1/reports/blockers.csv');
    expect(blockers.status).toBe(200);
    const blockersCsv = await blockers.text();
    expect(blockersCsv).toContain('"Line one of the blocker description.\nLine two includes a comma, a quote "" and more context."');
  });

  it('records every export request in report_exports', async () => {
    const rows = await env.DB.prepare(`SELECT report_type, COUNT(*) AS count FROM report_exports GROUP BY report_type`).all<{ report_type: string; count: number }>();
    const byType = new Map(rows.results.map((row) => [row.report_type, row.count]));
    expect(byType.get('tasks.csv')).toBeGreaterThanOrEqual(3);
    expect(byType.get('progress.csv')).toBeGreaterThanOrEqual(1);
    expect(byType.get('hardware.csv')).toBeGreaterThanOrEqual(1);
    expect(byType.get('blockers.csv')).toBeGreaterThanOrEqual(1);

    const scoped = await env.DB.prepare(`SELECT filters_json FROM report_exports WHERE report_type='tasks.csv' AND requested_by=? LIMIT 1`)
      .bind(MEMBER_ID).first<{ filters_json: string }>();
    expect(scoped).toBeDefined();
    expect(JSON.parse(scoped!.filters_json)).toMatchObject({ assigneeId: MEMBER_ID });

    const auditRows = await env.DB.prepare(`SELECT COUNT(*) AS count FROM audit_logs WHERE action='report.exported'`).first<{ count: number }>();
    expect(auditRows?.count ?? 0).toBeGreaterThanOrEqual(6);
  });
});
