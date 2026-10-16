import { readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const workspace = process.cwd();
const previewSecrets = path.join(workspace, 'dist', 'cerberus_workspace', '.dev.vars');
if (existsSync(previewSecrets)) await rm(previewSecrets);

const sourceSecrets = path.join(workspace, '.dev.vars');
if (existsSync(sourceSecrets)) {
  const secrets = (await readFile(sourceSecrets, 'utf8'))
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => line.slice(line.indexOf('=') + 1).trim())
    .filter((value) => value.length >= 8);
  const bundlePaths = [
    path.join(workspace, 'dist', 'cerberus_workspace', 'index.js'),
    ...await clientBundles(workspace),
  ];
  for (const bundlePath of bundlePaths) {
    const bundle = await readFile(bundlePath, 'utf8');
    if (secrets.some((secret) => bundle.includes(secret))) {
      throw new Error(`Build contains a value from .dev.vars: ${path.relative(workspace, bundlePath)}`);
    }
  }
}

async function clientBundles(root) {
  const { readdir } = await import('node:fs/promises');
  const assets = path.join(root, 'dist', 'client', 'assets');
  if (!existsSync(assets)) return [];
  return (await readdir(assets)).filter((name) => name.endsWith('.js')).map((name) => path.join(assets, name));
}
