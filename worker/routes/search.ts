import { Hono } from 'hono';
import { searchQuerySchema } from '../../shared/schemas/workspace';
import { requireAuth, requirePasswordChanged } from '../middleware/auth';
import { searchWorkspace } from '../services/search';
import type { Env, Variables } from '../types';

export const searchRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
searchRoutes.use('*', requireAuth, requirePasswordChanged);

searchRoutes.get('/', async (context) => {
  const query = (context.req.query('q') ?? '').trim();
  const requestedLimit = Number(context.req.query('limit') ?? 5);
  const limit = Number.isFinite(requestedLimit) ? Math.min(10, Math.max(1, requestedLimit)) : 5;

  if (query.length < 2) {
    return context.json({ ok: true, data: { query, groups: [], total: 0 }, meta: { minQueryLength: 2, limit } });
  }

  const parsed = searchQuerySchema.safeParse(query);
  if (!parsed.success) {
    return context.json({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Search queries must be between 2 and 100 characters' },
    }, 422);
  }

  const result = await searchWorkspace(context.env.DB, context.get('user'), parsed.data, limit);
  return context.json({ ok: true, data: result, meta: { limit, truncated: result.groups.some((group) => group.truncated) } });
});
