import { Hono, type Context } from 'hono';
import { experimentRunSchema, experimentSchema } from '../../shared/schemas/workspace';
import { requireAuth, requirePasswordChanged } from '../middleware/auth';
import { audit } from '../services/audit';
import { csvHeaders, toCsv } from '../services/csv';
import { isSupervisor } from '../services/wiki-access';
import type { Env, Variables } from '../types';

interface RunRow {
  id: string;
  runNumber: number;
  inputParametersJson: string;
  actualResults: string;
  validationNotes: string;
  performedAt: number;
  performedBy: string;
  performedByName: string;
  taskId: string | null;
  taskTitle: string | null;
  checkpointId: string | null;
  checkpointTitle: string | null;
}

interface MetricRow {
  runId: string;
  metricName: string;
  value: number | null;
  textValue: string | null;
  unit: string | null;
  observed: number;
}

export const experimentRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
experimentRoutes.use('*', requireAuth, requirePasswordChanged);

experimentRoutes.get('/', async (context) => {
  const rows = await context.env.DB.prepare(`SELECT e.*, u.display_name AS ownerName,
      (SELECT COUNT(*) FROM experiment_runs x WHERE x.experiment_id=e.id) AS runCount
    FROM experiments e JOIN users u ON u.id=e.owner_id
    WHERE e.archived_at IS NULL ORDER BY e.updated_at DESC`).all();
  return context.json({ ok: true, data: rows.results });
});

experimentRoutes.post('/', async (context) => {
  if (isSupervisor(context.get('user'))) return forbidden(context);
  const parsed = experimentSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) return validation(context, 'Experiment details are invalid', parsed.error.flatten().fieldErrors);
  const data = parsed.data;
  const id = crypto.randomUUID();
  await context.env.DB.prepare(`INSERT INTO experiments
    (id,project_id,owner_id,experiment_code,title,objective,hypothesis,environment,procedure,expected_results,reproducibility)
    VALUES (?,'project_cerberus',?,?,?,?,?,?,?,?,?)`)
    .bind(id, context.get('user').id, data.experimentCode, data.title, data.objective, data.hypothesis,
      data.environment, data.procedure, data.expectedResults, data.reproducibility).run();
  return context.json({ ok: true, data: { id } }, 201);
});

experimentRoutes.get('/:id/runs/export', async (context) => {
  const experiment = await context.env.DB.prepare(`SELECT id, experiment_code AS code FROM experiments WHERE id=?`)
    .bind(context.req.param('id')).first<{ id: string; code: string }>();
  if (!experiment) return notFound(context, 'Experiment');

  const rows = await context.env.DB.prepare(`SELECT r.run_number AS runNumber,
      datetime(r.performed_at,'unixepoch') AS performedUtc, u.display_name AS performedBy,
      COALESCE(t.title,'') AS task, COALESCE(c.title,'') AS checkpoint,
      r.actual_results AS actualResults, r.validation_notes AS validationNotes,
      res.metric_name AS metricName, res.value AS value, res.text_value AS textValue,
      COALESCE(res.unit,'') AS unit
    FROM experiment_runs r
    JOIN users u ON u.id=r.performed_by
    LEFT JOIN tasks t ON t.id=r.task_id
    LEFT JOIN checkpoints c ON c.id=r.checkpoint_id
    LEFT JOIN experiment_results res ON res.run_id=r.id
    WHERE r.experiment_id=?
    ORDER BY r.run_number DESC, res.metric_name`).bind(experiment.id).all<Record<string, unknown>>();

  await audit(context.env, context.get('user').id, 'experiment.runs_exported', 'experiment', experiment.id, {
    runCount: new Set(rows.results.map((row) => row.runNumber)).size,
  }).run();

  const csv = toCsv(
    ['run_number', 'performed_utc', 'performed_by', 'task', 'checkpoint', 'actual_results', 'validation_notes', 'metric_name', 'metric_value', 'metric_text', 'metric_unit'],
    rows.results.map((row) => [row.runNumber, row.performedUtc, row.performedBy, row.task, row.checkpoint,
      row.actualResults, row.validationNotes, row.metricName ?? '', row.value ?? '', row.textValue ?? '', row.unit]),
  );
  const safeCode = experiment.code.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/(^-|-$)/g, '') || 'experiment';
  return new Response(csv, {
    status: 200,
    headers: csvHeaders(`cerberus-${safeCode}-runs-${new Date().toISOString().slice(0, 10)}.csv`),
  });
});

experimentRoutes.get('/:id/runs', async (context) => {
  const experiment = await context.env.DB.prepare(`SELECT id FROM experiments WHERE id=? AND archived_at IS NULL`)
    .bind(context.req.param('id')).first();
  if (!experiment) return notFound(context, 'Experiment');

  const page = Math.max(1, Number(context.req.query('page') ?? 1));
  const limit = Math.min(100, Math.max(1, Number(context.req.query('limit') ?? 25)));

  const [runs, total] = await Promise.all([
    context.env.DB.prepare(`SELECT r.id, r.run_number AS runNumber, r.input_parameters AS inputParametersJson,
        r.actual_results AS actualResults, r.validation_notes AS validationNotes, r.performed_at AS performedAt,
        r.performed_by AS performedBy, u.display_name AS performedByName,
        r.task_id AS taskId, t.title AS taskTitle, r.checkpoint_id AS checkpointId, c.title AS checkpointTitle
      FROM experiment_runs r
      JOIN users u ON u.id=r.performed_by
      LEFT JOIN tasks t ON t.id=r.task_id
      LEFT JOIN checkpoints c ON c.id=r.checkpoint_id
      WHERE r.experiment_id=?
      ORDER BY r.run_number DESC LIMIT ? OFFSET ?`)
      .bind(context.req.param('id'), limit, (page - 1) * limit).all<RunRow>(),
    context.env.DB.prepare(`SELECT COUNT(*) AS count FROM experiment_runs WHERE experiment_id=?`)
      .bind(context.req.param('id')).first<{ count: number }>(),
  ]);

  const runIds = runs.results.map((run) => run.id);
  const metrics = runIds.length
    ? await context.env.DB.prepare(`SELECT run_id AS runId, metric_name AS metricName, value, text_value AS textValue,
        unit, observed FROM experiment_results WHERE run_id IN (${runIds.map(() => '?').join(',')})
        ORDER BY metric_name`).bind(...runIds).all<MetricRow>()
    : { results: [] as MetricRow[] };

  const metricsByRun = new Map<string, MetricRow[]>();
  for (const metric of metrics.results) {
    const list = metricsByRun.get(metric.runId) ?? [];
    list.push(metric);
    metricsByRun.set(metric.runId, list);
  }

  return context.json({
    ok: true,
    data: runs.results.map((run) => ({
      ...run,
      inputParameters: parseParameters(run.inputParametersJson),
      metrics: (metricsByRun.get(run.id) ?? []).map((metric) => ({
        name: metric.metricName,
        value: metric.value,
        text: metric.textValue,
        unit: metric.unit,
        observed: metric.observed === 1,
      })),
    })),
    meta: { page, limit, total: total?.count ?? 0, hasMore: page * limit < (total?.count ?? 0) },
  });
});

experimentRoutes.post('/:id/runs', async (context) => {
  const user = context.get('user');
  if (isSupervisor(user)) return forbidden(context);

  const parsed = experimentRunSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) return validation(context, 'Experiment run details are invalid', parsed.error.flatten().fieldErrors);

  const experiment = await context.env.DB.prepare(`SELECT owner_id FROM experiments WHERE id=? AND archived_at IS NULL`)
    .bind(context.req.param('id')).first<{ owner_id: string }>();
  if (!experiment) return notFound(context, 'Experiment');
  if (experiment.owner_id !== user.id && !user.roles.includes('super_admin')) return forbidden(context);

  const data = parsed.data;
  if (data.taskId) {
    const task = await context.env.DB.prepare(`SELECT 1 FROM tasks WHERE id=? AND archived_at IS NULL`).bind(data.taskId).first();
    if (!task) return context.json({ ok: false, error: { code: 'INVALID_TASK_LINK', message: 'Linked task does not exist' } }, 422);
  }
  if (data.checkpointId) {
    const checkpoint = await context.env.DB.prepare(`SELECT 1 FROM checkpoints WHERE id=? AND archived_at IS NULL`).bind(data.checkpointId).first();
    if (!checkpoint) return context.json({ ok: false, error: { code: 'INVALID_CHECKPOINT_LINK', message: 'Linked checkpoint does not exist' } }, 422);
  }

  const inputParameters = JSON.stringify(data.inputParameters);

  // D1 batches are atomic. A concurrent run may claim the same run number;
  // the unique (experiment_id, run_number) index rejects the loser and the
  // loop recomputes the number before retrying. No unbounded retry is used.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next = await context.env.DB.prepare(`SELECT COALESCE(MAX(run_number),0)+1 AS n FROM experiment_runs WHERE experiment_id=?`)
      .bind(context.req.param('id')).first<{ n: number }>();
    const runNumber = next?.n ?? 1;
    const runId = crypto.randomUUID();
    const statements = [
      context.env.DB.prepare(`INSERT INTO experiment_runs
        (id,experiment_id,run_number,input_parameters,actual_results,validation_notes,performed_by,task_id,checkpoint_id)
        VALUES (?,?,?,?,?,?,?,?,?)`)
        .bind(runId, context.req.param('id'), runNumber, inputParameters, data.actualResults,
          data.validationNotes, user.id, data.taskId ?? null, data.checkpointId ?? null),
      ...data.metrics.map((metric) => context.env.DB.prepare(`INSERT INTO experiment_results
        (id,run_id,metric_name,value,text_value,unit,observed) VALUES (?,?,?,?,?,?,?)`)
        .bind(crypto.randomUUID(), runId, metric.name, metric.value ?? null, metric.text ?? null,
          metric.unit || null, metric.observed ? 1 : 0)),
      audit(context.env, user.id, 'experiment.run_recorded', 'experiment', context.req.param('id'), {
        runId, runNumber, metricCount: data.metrics.length,
      }),
    ];

    try {
      await context.env.DB.batch(statements);
      return context.json({ ok: true, data: { id: runId, runNumber } }, 201);
    } catch (error) {
      if (!isUniqueConstraint(error)) throw error;
      if (attempt === 2) {
        return context.json({ ok: false, error: { code: 'RUN_NUMBER_CONFLICT', message: 'Could not allocate a run number; retry the request' } }, 409);
      }
    }
  }

  return context.json({ ok: false, error: { code: 'RUN_NUMBER_CONFLICT', message: 'Could not allocate a run number' } }, 409);
});

function parseParameters(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function isUniqueConstraint(error: unknown): boolean {
  return /UNIQUE constraint failed/i.test(error instanceof Error ? error.message : String(error));
}

function validation(context: Context, message: string, fields?: unknown) {
  return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message, fields } }, 422);
}
function notFound(context: Context, name: string) {
  return context.json({ ok: false, error: { code: 'NOT_FOUND', message: `${name} not found` } }, 404);
}
function forbidden(context: Context) {
  return context.json({ ok: false, error: { code: 'FORBIDDEN', message: 'This role cannot perform that action' } }, 403);
}
