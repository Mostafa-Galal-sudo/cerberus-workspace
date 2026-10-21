import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const prepared = JSON.parse(readFileSync(path.resolve('tests/e2e/.auth/prepared.json'), 'utf8')) as {
  temp: { email: string; password: string };
};

test.describe.configure({ retries: 0 });

test('replaces a temporary password at the mandatory sentinel gate', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(prepared.temp.email);
  await page.getByLabel('Password').fill(prepared.temp.password);
  await page.getByRole('button', { name: 'Enter workspace' }).click();

  await expect(page.getByRole('heading', { name: 'Replace temporary password' })).toBeVisible();
  await page.getByLabel('Temporary password').fill(prepared.temp.password);
  await page.getByLabel('New master password').fill('E2e!Nabil2026');
  await page.getByLabel('Confirm new password').fill('E2e!Nabil2026');
  await page.getByRole('button', { name: /Establish password and proceed/ }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Nabil');
});
