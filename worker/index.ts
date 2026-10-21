import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { adminRoutes } from './routes/admin';
import { assistantRoutes } from './routes/assistant';
import { attachmentRoutes } from './routes/attachments';
import { authRoutes } from './routes/auth';
import { collaborationRoutes } from './routes/collaboration';
import { dashboardRoutes } from './routes/dashboard';
import { githubRoutes } from './routes/github';
import { reviewRoutes } from './routes/reviews';
import { reportRoutes } from './routes/reports';
import { setupRoutes } from './routes/setup';
import { taskRoutes } from './routes/tasks';
import { userRoutes } from './routes/users';
import { workspaceModuleRoutes } from './routes/workspace-modules';
import type { Env, Variables } from './types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com'],
    imgSrc: ["'self'", 'data:', 'https:'],
    connectSrc: ["'self'"],
    frameAncestors: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    objectSrc: ["'none'"],
    frameSrc: ["'none'"],
    manifestSrc: ["'self'"],
    upgradeInsecureRequests: [],
  },
  referrerPolicy: 'no-referrer',
  xFrameOptions: 'DENY',
}));
app.use('/api/*', async (context, next) => {
  const origin = context.req.header('Origin');
  const allowedOrigin = context.env.APP_ORIGIN ?? new URL(context.req.url).origin;
  if (origin && origin !== allowedOrigin) return context.json({ ok: false, error: { code: 'ORIGIN_DENIED', message: 'Origin is not allowed' } }, 403);
  return cors({ origin: allowedOrigin, credentials: true, allowHeaders: ['Content-Type', 'X-CSRF-Token'], allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] })(context, next);
});

app.get('/api/v1/health', (context) => context.json({ ok: true, data: { service: 'cerberus-workspace', environment: context.env.APP_ENV } }));
app.route('/api/v1/setup', setupRoutes);
app.route('/api/v1/auth', authRoutes);
app.route('/api/v1/dashboard', dashboardRoutes);
app.route('/api/v1/tasks', taskRoutes);
app.route('/api/v1/reviews', reviewRoutes);
app.route('/api/v1/reports', reportRoutes);
app.route('/api/v1/users', userRoutes);
app.route('/api/v1/collaboration', collaborationRoutes);
app.route('/api/v1/attachments', attachmentRoutes);
app.route('/api/v1/workspace', workspaceModuleRoutes);
app.route('/api/v1/github', githubRoutes);
app.route('/api/v1/admin', adminRoutes);
app.route('/api/v1/assistant', assistantRoutes);

app.notFound((context) => context.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Endpoint not found' } }, 404));
app.onError((error, context) => {
  console.error(JSON.stringify({ level: 'error', path: context.req.path, method: context.req.method, message: error.message }));
  return context.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } }, 500);
});

export default app;
