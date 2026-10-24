import { Hono, type Context } from 'hono';
import {
  hardwareCheckoutSchema,
  hardwareMaintenanceSchema,
  hardwareReturnSchema,
  hardwareSchema,
} from '../../shared/schemas/workspace';
import { requireAuth, requirePasswordChanged, requirePermission } from '../middleware/auth';
import { audit } from '../services/audit';
import { escapeLikePattern } from '../services/search';
import { isWorkspaceAdmin } from '../services/wiki-access';
import type { Env, Variables } from '../types';

interface HardwareRow {
  id: string;
  name: string;
  model: string;
  serial_number: string;
  quantity: number;
  unit_cost: number | null;
  condition: string;
  purchase_status: string;
  tracking_mode: string;
  min_quantity: number;
  datasheet_url: string;
  notes: string;
  checkedOutQuantity: number;
}

interface AssignmentRow {
  id: string;
  hardwareId: string;
  holderId: string;
  holderName: string;
  quantity: number;
  notes: string;
  checkedOutAt: number;
  checkedInAt: number | null;
  conditionOnReturn: string | null;
  returnNotes: string;
  returnedByName: string | null;
  createdByName: string;
}

export const hardwareRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
hardwareRoutes.use('*', requireAuth, requirePasswordChanged);

const openAssignmentQuantity = `COALESCE((SELECT SUM(a.quantity) FROM hardware_assignments a
  WHERE a.hardware_id=h.id AND a.checked_in_at IS NULL),0)`;

hardwareRoutes.get('/', async (context) => {
  const page = Math.max(1, Number(context.req.query('page') ?? 1));
  const limit = Math.min(100, Math.max(1, Number(context.req.query('limit') ?? 50)));
  const search = context.req.query('search')?.trim();

  const conditions = ['h.archived_at IS NULL'];
  const bindings: unknown[] = [];
  if (search) {
    const pattern = `%${escapeLikePattern(search)}%`;
    conditions.push(`(h.name LIKE ? ESCAPE '\\' OR h.model LIKE ? ESCAPE '\\' OR h.serial_number LIKE ? ESCAPE '\\')`);
    bindings.push(pattern, pattern, pattern);
  }

  const where = conditions.join(' AND ');
  const [rows, total] = await Promise.all([
    context.env.DB.prepare(`SELECT h.*, ${openAssignmentQuantity} AS checkedOutQuantity,
        (h.quantity - ${openAssignmentQuantity}) AS availableQuantity,
        (SELECT u.display_name FROM hardware_assignments a JOIN users u ON u.id=a.holder_id
          WHERE a.hardware_id=h.id AND a.checked_in_at IS NULL
          ORDER BY a.checked_out_at DESC LIMIT 1) AS currentHolder
      FROM hardware_items h WHERE ${where}
      ORDER BY h.name LIMIT ? OFFSET ?`)
      .bind(...bindings, limit, (page - 1) * limit).all<HardwareRow & { availableQuantity: number; currentHolder: string | null }>(),
    context.env.DB.prepare(`SELECT COUNT(*) AS count FROM hardware_items h WHERE ${where}`)
      .bind(...bindings).first<{ count: number }>(),
  ]);

  return context.json({
    ok: true,
    data: rows.results.map((row) => ({
      ...row,
      availableQuantity: Math.max(0, row.availableQuantity),
      lowStock: row.availableQuantity <= row.min_quantity,
    })),
    meta: { page, limit, total: total?.count ?? 0, hasMore: page * limit < (total?.count ?? 0) },
  });
});

hardwareRoutes.post('/', requirePermission('workspace.admin'), async (context) => {
  const parsed = hardwareSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) return validation(context, 'Hardware details are invalid', parsed.error.flatten().fieldErrors);
  const data = parsed.data;
  const id = crypto.randomUUID();

  await context.env.DB.batch([
    context.env.DB.prepare(`INSERT INTO hardware_items
      (id,name,model,serial_number,quantity,unit_cost,condition,purchase_status,tracking_mode,min_quantity,datasheet_url,notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, data.name, data.model, data.serialNumber, data.quantity, data.unitCost ?? null, data.condition,
        data.purchaseStatus, data.trackingMode, data.minQuantity, data.datasheetUrl, data.notes),
    audit(context.env, context.get('user').id, 'hardware.created', 'hardware_item', id, {
      trackingMode: data.trackingMode,
      quantity: data.quantity,
    }),
  ]);

  return context.json({ ok: true, data: { id } }, 201);
});

hardwareRoutes.get('/:id', async (context) => {
  const item = await context.env.DB.prepare(`SELECT h.*, ${openAssignmentQuantity} AS checkedOutQuantity,
      (h.quantity - ${openAssignmentQuantity}) AS availableQuantity
    FROM hardware_items h WHERE h.id=? AND h.archived_at IS NULL`)
    .bind(context.req.param('id')).first<HardwareRow & { availableQuantity: number }>();
  if (!item) return notFound(context, 'Hardware item');

  const [assignments, maintenance] = await Promise.all([
    context.env.DB.prepare(`SELECT a.id, a.hardware_id AS hardwareId, a.holder_id AS holderId,
        holder.display_name AS holderName, a.quantity, a.notes, a.checked_out_at AS checkedOutAt,
        a.checked_in_at AS checkedInAt, a.condition_on_return AS conditionOnReturn, a.return_notes AS returnNotes,
        returned.display_name AS returnedByName, creator.display_name AS createdByName
      FROM hardware_assignments a
      JOIN users holder ON holder.id=a.holder_id
      JOIN users creator ON creator.id=a.created_by
      LEFT JOIN users returned ON returned.id=a.returned_by
      WHERE a.hardware_id=? ORDER BY a.checked_out_at DESC LIMIT 100`)
      .bind(item.id).all<AssignmentRow>(),
    context.env.DB.prepare(`SELECT m.id, m.kind, m.performed_at AS performedAt, m.next_due_at AS nextDueAt,
        m.notes, m.created_at AS createdAt, u.display_name AS performedByName
      FROM hardware_maintenance m JOIN users u ON u.id=m.performed_by
      WHERE m.hardware_id=? ORDER BY m.performed_at DESC LIMIT 100`)
      .bind(item.id).all(),
  ]);

  const latestMaintenance = maintenance.results[0] as { nextDueAt: number | null } | undefined;
  const now = Math.floor(Date.now() / 1000);

  return context.json({
    ok: true,
    data: {
      item: {
        ...item,
        availableQuantity: Math.max(0, item.availableQuantity),
        lowStock: item.availableQuantity <= item.min_quantity,
      },
      assignments: assignments.results,
      maintenance: maintenance.results,
      maintenanceOverdue: Boolean(latestMaintenance?.nextDueAt && latestMaintenance.nextDueAt <= now),
      canManage: isWorkspaceAdmin(context.get('user')),
    },
  });
});

hardwareRoutes.post('/:id/checkout', requirePermission('workspace.admin'), async (context) => {
  const parsed = hardwareCheckoutSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) return validation(context, 'Checkout details are invalid', parsed.error.flatten().fieldErrors);
  const data = parsed.data;

  const item = await context.env.DB.prepare(`SELECT id, name, quantity, tracking_mode AS trackingMode,
      condition, purchase_status AS purchaseStatus,
      (quantity - ${openAssignmentQuantity}) AS availableQuantity
    FROM hardware_items h WHERE h.id=? AND h.archived_at IS NULL`)
    .bind(context.req.param('id')).first<{
      id: string; name: string; quantity: number; trackingMode: string; condition: string;
      purchaseStatus: string; availableQuantity: number;
    }>();
  if (!item) return notFound(context, 'Hardware item');
  if (item.trackingMode === 'serialized' && data.quantity !== 1) {
    return conflict(context, 'SERIALIZED_UNIT', 'A serialized item is a single physical unit; check out exactly one');
  }
  if (item.purchaseStatus !== 'available' || ['retired', 'damaged'].includes(item.condition)) {
    return conflict(context, 'ITEM_UNAVAILABLE', 'This item is not available for checkout');
  }

  const holder = await context.env.DB.prepare(`SELECT 1 FROM users WHERE id=? AND status='active' AND archived_at IS NULL`)
    .bind(data.holderId).first();
  if (!holder) return validation(context, 'The selected holder is not an active workspace member');

  const assignmentId = crypto.randomUUID();
  // The availability check runs inside the INSERT so two concurrent checkouts
  // cannot both consume the same units.
  const result = await context.env.DB.prepare(`INSERT INTO hardware_assignments
      (id,hardware_id,holder_id,quantity,notes,created_by)
    SELECT ?,?,?,?,?,?
    WHERE EXISTS (
      SELECT 1 FROM hardware_items h
      WHERE h.id=? AND h.archived_at IS NULL AND h.purchase_status='available'
        AND h.condition NOT IN ('retired','damaged')
        AND h.quantity - COALESCE((SELECT SUM(a.quantity) FROM hardware_assignments a
          WHERE a.hardware_id=h.id AND a.checked_in_at IS NULL),0) >= ?
    )`)
    .bind(assignmentId, item.id, data.holderId, data.quantity, data.notes, context.get('user').id, item.id, data.quantity)
    .run();

  if ((result.meta.changes ?? 0) === 0) {
    return conflict(context, 'QUANTITY_UNAVAILABLE', 'Not enough units are available');
  }

  await audit(context.env, context.get('user').id, 'hardware.checked_out', 'hardware_item', item.id, {
    assignmentId, holderId: data.holderId, quantity: data.quantity,
  }).run();

  return context.json({ ok: true, data: { id: assignmentId } }, 201);
});

hardwareRoutes.post('/assignments/:id/return', async (context) => {
  const parsed = hardwareReturnSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) return validation(context, 'Return details are invalid', parsed.error.flatten().fieldErrors);
  const user = context.get('user');

  const assignment = await context.env.DB.prepare(`SELECT a.id, a.hardware_id AS hardwareId, a.holder_id AS holderId,
      a.quantity, a.checked_in_at AS checkedInAt, h.name
    FROM hardware_assignments a JOIN hardware_items h ON h.id=a.hardware_id
    WHERE a.id=?`)
    .bind(context.req.param('id')).first<{
      id: string; hardwareId: string; holderId: string; quantity: number; checkedInAt: number | null; name: string;
    }>();
  if (!assignment) return notFound(context, 'Hardware assignment');
  if (assignment.checkedInAt !== null) return conflict(context, 'ALREADY_RETURNED', 'This assignment was already returned');
  if (assignment.holderId !== user.id && !isWorkspaceAdmin(user)) return forbidden(context);

  const result = await context.env.DB.prepare(`UPDATE hardware_assignments
    SET checked_in_at=unixepoch(), condition_on_return=?, return_notes=?, returned_by=?
    WHERE id=? AND checked_in_at IS NULL`)
    .bind(parsed.data.condition, parsed.data.notes, user.id, assignment.id).run();
  if ((result.meta.changes ?? 0) === 0) return conflict(context, 'ALREADY_RETURNED', 'This assignment was already returned');

  await audit(context.env, user.id, 'hardware.returned', 'hardware_item', assignment.hardwareId, {
    assignmentId: assignment.id, condition: parsed.data.condition, quantity: assignment.quantity,
  }).run();

  return context.json({ ok: true, data: { returned: true } });
});

hardwareRoutes.post('/:id/maintenance', requirePermission('workspace.admin'), async (context) => {
  const parsed = hardwareMaintenanceSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) return validation(context, 'Maintenance details are invalid', parsed.error.flatten().fieldErrors);
  const item = await context.env.DB.prepare(`SELECT id FROM hardware_items WHERE id=? AND archived_at IS NULL`)
    .bind(context.req.param('id')).first<{ id: string }>();
  if (!item) return notFound(context, 'Hardware item');

  const id = crypto.randomUUID();
  const performedAt = parsed.data.performedAt ?? Math.floor(Date.now() / 1000);
  await context.env.DB.batch([
    context.env.DB.prepare(`INSERT INTO hardware_maintenance
      (id,hardware_id,kind,performed_by,performed_at,next_due_at,notes) VALUES (?,?,?,?,?,?,?)`)
      .bind(id, item.id, parsed.data.kind, context.get('user').id, performedAt, parsed.data.nextDueAt ?? null, parsed.data.notes),
    audit(context.env, context.get('user').id, 'hardware.maintenance_recorded', 'hardware_item', item.id, {
      recordId: id, kind: parsed.data.kind,
    }),
  ]);

  return context.json({ ok: true, data: { id } }, 201);
});

function validation(context: Context, message: string, fields?: unknown) {
  return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message, fields } }, 422);
}
function notFound(context: Context, name: string) {
  return context.json({ ok: false, error: { code: 'NOT_FOUND', message: `${name} not found` } }, 404);
}
function forbidden(context: Context) {
  return context.json({ ok: false, error: { code: 'FORBIDDEN', message: 'This role cannot perform that action' } }, 403);
}
function conflict(context: Context, code: string, message: string) {
  return context.json({ ok: false, error: { code, message } }, 409);
}
