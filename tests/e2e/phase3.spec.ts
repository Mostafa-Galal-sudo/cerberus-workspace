import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { totpCode } from '../../worker/services/mfa';

const prepared = JSON.parse(readFileSync(path.resolve('tests/e2e/.auth/prepared.json'), 'utf8')) as {
  admin: { email: string; password: string };
  storage: { admin: string };
};

test.use({ storageState: prepared.storage.admin });
test.describe.configure({ retries: 0 });

test('enables and disables authenticator protection from the account security center', async ({ page }) => {
  await page.goto('/account/security');
  await expect(page.getByRole('heading', { name: 'Protect your workspace identity' })).toBeVisible();
  await expect(page.getByText(prepared.admin.email)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Active sessions' })).toBeVisible();
  await expect(page.getByText('This session')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Authentication history' })).toBeVisible();
  await expect(page.getByText('Success').first()).toBeVisible();

  await page.getByRole('button', { name: /Enable authenticator protection/ }).click();
  const secret = (await page.locator('.security-secret code').innerText()).trim();
  expect(secret.length).toBeGreaterThan(15);

  const code = await totpCode(secret, Math.floor(Date.now() / 1000 / 30));
  await page.getByLabel('6-digit authenticator code').fill(code);
  await page.getByRole('button', { name: 'Confirm and enable' }).click();

  const recoveryCodes = page.locator('.recovery-grid code');
  await expect(recoveryCodes).toHaveCount(10);
  const firstRecoveryCode = (await recoveryCodes.first().innerText()).trim();
  await page.getByRole('button', { name: 'I stored these codes' }).click();

  await expect(page.getByText('MFA enabled')).toBeVisible();
  await expect(page.getByRole('button', { name: /Disable MFA/ })).toBeVisible();

  await page.getByRole('button', { name: /Disable MFA/ }).click();
  await page.getByLabel('Current password').fill(prepared.admin.password);
  await page.getByLabel('Authenticator or recovery code').fill(firstRecoveryCode);
  await page.getByRole('button', { name: 'Disable MFA and revoke other sessions' }).click();

  await expect(page.getByText('MFA not enabled')).toBeVisible();
});

test('persists assistant threads across reloads and archives them', async ({ page }) => {
  const question = 'What is the current task status across the workspace?';

  await page.goto('/assistant');
  await expect(page.getByRole('heading', { name: 'Cerberus AI Engineering Assistant' })).toBeVisible();

  await page.getByRole('button', { name: 'New thread' }).click();
  await page.getByLabel('Ask the assistant a question').fill(question);
  await page.getByRole('button', { name: 'Send' }).click();

  await expect(page.getByText('Current workspace task ledger status:')).toBeVisible();
  await expect(page.getByText('RETRIEVED SOURCES (server-read, not model-verified)')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: new RegExp(question) }).first()).toBeVisible();
  await expect(page.getByText('Current workspace task ledger status:')).toBeVisible();

  await page.getByRole('button', { name: `Archive ${question}` }).click();
  await expect(page.getByText('No threads yet. Ask the assistant to start one.')).toBeVisible();
});
