import { Hono } from 'hono';
import { requireAuth, requirePasswordChanged, requireRole } from '../middleware/auth';
import { audit } from '../services/audit';
import { csvHeaders, toCsv } from '../services/csv';
import { renderReportPdf } from '../services/pdf';
import type { Env, Variables } from '../types';

export const reportRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
reportRoutes.use('*', requireAuth, requirePasswordChanged);

function today() {
  return new Date().toISOString().slice(0, 10);
}

const teamReportAccess = requireRole('super_admin', 'project_supervisor');

async function recordExport(env: Env, userId: string, reportType: string, filters: Record<string, unknown>) {
  const exportId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO report_exports (id, requested_by, report_type, filters_json) VALUES (?, ?, ?, ?)`)
      .bind(exportId, userId, reportType, JSON.stringify(filters)),
    audit(env, userId, 'report.exported', 'report_export', exportId, { reportType, filters }),
  ]);
}

function pdfHeaders(filename: string): HeadersInit {
  return {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
  };
}

reportRoutes.get('/tasks.csv', async (context) => {
  const user = context.get('user');
  const privileged = user.permissions.includes('workspace.admin') || user.roles.includes('project_supervisor');
  const filters = privileged ? {} : { assigneeId: user.id };

  const rows = await context.env.DB.prepare(`SELECT t.id, t.title, t.status, t.priority,
      COALESCE(u.display_name, 'Unassigned') AS assignee,
      COALESCE(d.name, 'Unclassified') AS domain,
      COALESCE((SELECT c.title FROM checkpoint_tasks ct JOIN checkpoints c ON c.id=ct.checkpoint_id
        WHERE ct.task_id=t.id LIMIT 1), '') AS checkpoint,
      datetime(t.created_at, 'unixepoch') AS created_utc,
      datetime(t.approved_at, 'unixepoch') AS approved_utc
    FROM tasks t
    LEFT JOIN users u ON u.id=t.assignee_id
    LEFT JOIN engineering_domains d ON d.id=t.domain_id
    WHERE t.archived_at IS NULL ${privileged ? '' : 'AND t.assignee_id = ?'}
    ORDER BY t.updated_at DESC`).bind(...(privileged ? [] : [user.id])).all();

  await recordExport(context.env, user.id, 'tasks.csv', filters);
  const csv = toCsv(
    ['id', 'title', 'status', 'priority', 'assignee', 'domain', 'checkpoint', 'created_utc', 'approved_utc'],
    rows.results.map((row) => {
      const record = row as Record<string, unknown>;
      return [record.id, record.title, record.status, record.priority, record.assignee, record.domain, record.checkpoint, record.created_utc, record.approved_utc];
    }),
  );

  return new Response(csv, { status: 200, headers: csvHeaders(`cerberus-tasks-${today()}.csv`) });
});

reportRoutes.get('/progress.csv', teamReportAccess, async (context) => {
  const user = context.get('user');
  const rows = await context.env.DB.prepare(`SELECT u.display_name AS member, u.email, u.specialization,
      COALESCE(d.name, '') AS domain,
      (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id=u.id AND t.archived_at IS NULL) AS total_tasks,
      (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id=u.id AND t.status='approved' AND t.archived_at IS NULL) AS approved_tasks,
      (SELECT COUNT(*) FROM checkpoints c WHERE c.owner_id=u.id AND c.archived_at IS NULL) AS total_checkpoints,
      (SELECT COUNT(*) FROM checkpoints c WHERE c.owner_id=u.id AND c.status='approved' AND c.archived_at IS NULL) AS approved_checkpoints
    FROM users u
    JOIN user_roles ur ON ur.user_id=u.id AND ur.role_id='role_member'
    LEFT JOIN checkpoints c ON c.owner_id=u.id
    LEFT JOIN milestones m ON m.id=c.milestone_id
    LEFT JOIN engineering_domains d ON d.id=m.domain_id
    WHERE u.archived_at IS NULL
    GROUP BY u.id
    ORDER BY u.display_name`).all();

  await recordExport(context.env, user.id, 'progress.csv', {});
  const csv = toCsv(
    ['member', 'email', 'specialization', 'domain', 'total_tasks', 'approved_tasks', 'total_checkpoints', 'approved_checkpoints', 'task_progress_percent'],
    rows.results.map((row) => {
      const record = row as Record<string, unknown>;
      const total = Number(record.total_tasks ?? 0);
      const approved = Number(record.approved_tasks ?? 0);
      return [record.member, record.email, record.specialization, record.domain, total, approved, record.total_checkpoints, record.approved_checkpoints, total ? Math.round((approved / total) * 100) : 0];
    }),
  );

  return new Response(csv, { status: 200, headers: csvHeaders(`cerberus-progress-${today()}.csv`) });
});

reportRoutes.get('/hardware.csv', teamReportAccess, async (context) => {
  const user = context.get('user');
  const rows = await context.env.DB.prepare(`SELECT h.id, h.name, h.model, h.serial_number, h.quantity, h.condition,
      h.purchase_status, h.unit_cost,
      COALESCE((SELECT u.display_name FROM hardware_assignments a JOIN users u ON u.id=a.holder_id
        WHERE a.hardware_id=h.id AND a.checked_in_at IS NULL ORDER BY a.checked_out_at DESC LIMIT 1), 'Lab Available') AS current_holder
    FROM hardware_items h
    WHERE h.archived_at IS NULL
    ORDER BY h.name`).all();

  await recordExport(context.env, user.id, 'hardware.csv', {});
  const csv = toCsv(
    ['id', 'name', 'model', 'serial_number', 'quantity', 'condition', 'purchase_status', 'unit_cost', 'current_holder'],
    rows.results.map((row) => {
      const record = row as Record<string, unknown>;
      return [record.id, record.name, record.model, record.serial_number, record.quantity, record.condition, record.purchase_status, record.unit_cost, record.current_holder];
    }),
  );

  return new Response(csv, { status: 200, headers: csvHeaders(`cerberus-hardware-${today()}.csv`) });
});

reportRoutes.get('/blockers.csv', teamReportAccess, async (context) => {
  const user = context.get('user');
  const rows = await context.env.DB.prepare(`SELECT b.id, b.title, b.severity, b.status, b.description, b.resolution_notes,
      u.display_name AS reporter,
      datetime(b.created_at, 'unixepoch') AS created_utc,
      datetime(b.resolved_at, 'unixepoch') AS resolved_utc
    FROM blockers b JOIN users u ON u.id=b.reporter_id
    ORDER BY b.created_at DESC`).all();

  await recordExport(context.env, user.id, 'blockers.csv', {});
  const csv = toCsv(
    ['id', 'title', 'severity', 'status', 'description', 'resolution_notes', 'reporter', 'created_utc', 'resolved_utc'],
    rows.results.map((row) => {
      const record = row as Record<string, unknown>;
      return [record.id, record.title, record.severity, record.status, record.description, record.resolution_notes, record.reporter, record.created_utc, record.resolved_utc];
    }),
  );

  return new Response(csv, { status: 200, headers: csvHeaders(`cerberus-blockers-${today()}.csv`) });
});

reportRoutes.get('/progress.pdf', teamReportAccess, async (context) => {
  const user = context.get('user');
  const rows = await context.env.DB.prepare(`SELECT u.display_name AS member, u.email, u.specialization,
      COALESCE(d.name, '') AS domain,
      (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id=u.id AND t.archived_at IS NULL) AS total_tasks,
      (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id=u.id AND t.status='approved' AND t.archived_at IS NULL) AS approved_tasks,
      (SELECT COUNT(*) FROM checkpoints c WHERE c.owner_id=u.id AND c.archived_at IS NULL) AS total_checkpoints,
      (SELECT COUNT(*) FROM checkpoints c WHERE c.owner_id=u.id AND c.status='approved' AND c.archived_at IS NULL) AS approved_checkpoints
    FROM users u
    JOIN user_roles ur ON ur.user_id=u.id AND ur.role_id='role_member'
    LEFT JOIN checkpoints c ON c.owner_id=u.id
    LEFT JOIN milestones m ON m.id=c.milestone_id
    LEFT JOIN engineering_domains d ON d.id=m.domain_id
    WHERE u.archived_at IS NULL
    GROUP BY u.id
    ORDER BY u.display_name`).all();

  const data = rows.results.map((row) => {
    const record = row as Record<string, unknown>;
    const total = Number(record.total_tasks ?? 0);
    const approved = Number(record.approved_tasks ?? 0);
    return [
      String(record.member ?? ''),
      String(record.specialization ?? ''),
      String(record.domain ?? ''),
      `${approved} / ${total}`,
      `${record.approved_checkpoints ?? 0} / ${record.total_checkpoints ?? 0}`,
      `${total ? Math.round((approved / total) * 100) : 0}%`,
    ];
  });

  await recordExport(context.env, user.id, 'progress.pdf', {});
  const pdf = await renderReportPdf({
    title: 'Discipline Roadmap Progress Summary',
    subtitle: 'CERBERUS Autonomous IoT Cyber Defense Platform - Academic Graduation Project',
    summary: [
      `Generated for ${user.displayName} (${user.email}).`,
      'Approved values are derived from independently reviewed task and checkpoint submissions.',
    ],
    columns: [
      { header: 'Discipline lead', weight: 1.5 },
      { header: 'Specialization', weight: 2.2 },
      { header: 'Domain', weight: 1.8 },
      { header: 'Tasks approved', weight: 1.2 },
      { header: 'Checkpoints', weight: 1.2 },
      { header: 'Task progress', weight: 1 },
    ],
    rows: data,
  });

  return new Response(pdf as unknown as BodyInit, { status: 200, headers: pdfHeaders(`cerberus-progress-${today()}.pdf`) });
});

reportRoutes.get('/hardware.pdf', teamReportAccess, async (context) => {
  const user = context.get('user');
  const rows = await context.env.DB.prepare(`SELECT h.name, h.model, h.serial_number, h.quantity, h.condition,
      h.purchase_status, h.unit_cost,
      COALESCE((SELECT u.display_name FROM hardware_assignments a JOIN users u ON u.id=a.holder_id
        WHERE a.hardware_id=h.id AND a.checked_in_at IS NULL ORDER BY a.checked_out_at DESC LIMIT 1), 'Lab Available') AS current_holder
    FROM hardware_items h
    WHERE h.archived_at IS NULL
    ORDER BY h.name`).all();

  await recordExport(context.env, user.id, 'hardware.pdf', {});
  const pdf = await renderReportPdf({
    title: 'Hardware Asset & Testbed Ledger',
    subtitle: 'CERBERUS Autonomous IoT Cyber Defense Platform - Physical inventory provenance',
    summary: [
      `Generated for ${user.displayName} (${user.email}).`,
      'Allocated units are derived from active checkout records; returned units remain in the ledger.',
    ],
    columns: [
      { header: 'Component', weight: 2 },
      { header: 'Model', weight: 2 },
      { header: 'Serial', weight: 1.5 },
      { header: 'Qty', weight: 0.6 },
      { header: 'Condition', weight: 0.9 },
      { header: 'Unit cost', weight: 0.8 },
      { header: 'Allocation', weight: 1.6 },
    ],
    rows: rows.results.map((row) => {
      const record = row as Record<string, unknown>;
      return [
        String(record.name ?? ''),
        String(record.model ?? ''),
        String(record.serial_number ?? ''),
        String(record.quantity ?? ''),
        String(record.condition ?? ''),
        record.unit_cost === null || record.unit_cost === undefined ? '-' : `$${Number(record.unit_cost).toFixed(2)}`,
        String(record.current_holder ?? ''),
      ];
    }),
  });

  return new Response(pdf as unknown as BodyInit, { status: 200, headers: pdfHeaders(`cerberus-hardware-${today()}.pdf`) });
});

reportRoutes.get('/blockers.pdf', teamReportAccess, async (context) => {
  const user = context.get('user');
  const rows = await context.env.DB.prepare(`SELECT b.title, b.severity, b.status, b.description, b.resolution_notes,
      u.display_name AS reporter,
      datetime(b.created_at, 'unixepoch') AS created_utc,
      datetime(b.resolved_at, 'unixepoch') AS resolved_utc
    FROM blockers b JOIN users u ON u.id=b.reporter_id
    ORDER BY b.created_at DESC`).all();

  await recordExport(context.env, user.id, 'blockers.pdf', {});
  const pdf = await renderReportPdf({
    title: 'Blocker & Security Resolution Audit',
    subtitle: 'CERBERUS Autonomous IoT Cyber Defense Platform - Operational risk review',
    summary: [
      `Generated for ${user.displayName} (${user.email}).`,
      'Resolution notes are recorded by the accountable assignee and retained in the audit trail.',
    ],
    columns: [
      { header: 'Blocker', weight: 2.2 },
      { header: 'Severity', weight: 0.8 },
      { header: 'Status', weight: 0.8 },
      { header: 'Description', weight: 3 },
      { header: 'Resolution', weight: 2.4 },
      { header: 'Reported by', weight: 1.2 },
      { header: 'Reported UTC', weight: 1.2 },
    ],
    rows: rows.results.map((row) => {
      const record = row as Record<string, unknown>;
      return [
        String(record.title ?? ''),
        String(record.severity ?? ''),
        String(record.status ?? ''),
        String(record.description ?? ''),
        String(record.resolution_notes ?? ''),
        String(record.reporter ?? ''),
        String(record.created_utc ?? ''),
      ];
    }),
  });

  return new Response(pdf as unknown as BodyInit, { status: 200, headers: pdfHeaders(`cerberus-blockers-${today()}.pdf`) });
});
