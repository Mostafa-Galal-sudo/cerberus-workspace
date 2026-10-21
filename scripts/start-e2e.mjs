import { spawn, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';
const npx = isWindows ? 'npx.cmd' : 'npx';
const env = {
  ...process.env,
  CI: '1',
  WRANGLER_SEND_METRICS: 'false',
};

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: true, env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log('[e2e] building the production bundle');
run(npm, ['run', 'build']);

console.log('[e2e] resetting isolated local persistence');
rmSync('.wrangler/e2e-state', { recursive: true, force: true });

console.log('[e2e] applying migrations to the isolated e2e D1 database');
run(npx, [
  'wrangler', 'd1', 'migrations', 'apply', 'cerberus-workspace-e2e',
  '--local', '--config', 'wrangler.e2e.jsonc', '--persist-to', '.wrangler/e2e-state',
]);

console.log('[e2e] starting wrangler dev on http://127.0.0.1:4173');
const child = spawn(npx, [
  'wrangler', 'dev',
  '--config', 'wrangler.e2e.jsonc',
  '--ip', '127.0.0.1',
  '--port', '4173',
  '--local',
  '--persist-to', '.wrangler/e2e-state',
  '--show-interactive-dev-session=false',
  '--var', 'APP_ORIGIN:http://127.0.0.1:4173',
  '--var', 'SETUP_TOKEN:e2e-setup-token',
  '--var', 'APP_ENV:test',
  '--log-level', 'warn',
], { stdio: 'inherit', shell: true, env });

const shutdown = () => {
  if (!child.killed) child.kill();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', shutdown);

child.on('error', (error) => {
  console.error('[e2e] failed to start wrangler dev:', error);
  process.exit(1);
});
child.on('exit', (code) => {
  process.exit(code ?? 0);
});
