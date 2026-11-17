import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Deliberately NOT using ./fixtures: this spec exercises the Learning Guide,
// which must auto-open because the storageState carries no localStorage.
const prepared = JSON.parse(
  readFileSync(path.resolve('tests/e2e/.auth/prepared.json'), 'utf8'),
) as { storage: { admin: string } };

test.use({ storageState: prepared.storage.admin });

test('auto-opens on first visit, walks real routes, and persists dismissal', async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto('/');
  const guide = page.getByRole('dialog', { name: 'Learning guide' });
  await expect(guide).toBeVisible();
  await expect(guide.getByRole('heading', { name: 'Welcome to CERBERUS' })).toBeVisible();

  const next = guide.getByRole('button', { name: 'Next' });
  const previous = guide.getByRole('button', { name: 'Previous' });

  // Step 2 targets the sidebar rail.
  await next.click();
  await expect(guide.getByRole('heading', { name: 'Navigate the workspace' })).toBeVisible();
  await expect(previous).toBeEnabled();

  // Advance to the tasks step and confirm the guide actually navigated.
  await next.click(); // search
  await next.click(); // alerts
  await next.click(); // dashboard
  await next.click(); // tasks
  await expect(guide.getByRole('heading', { name: 'Task register & statuses' })).toBeVisible();
  await expect(page).toHaveURL(/\/tasks$/);

  // Previous walks back to the dashboard step.
  await previous.click();
  await expect(guide.getByRole('heading', { name: 'Your dashboard' })).toBeVisible();

  // Escape skips the tour and records a per-user dismissed marker.
  await page.keyboard.press('Escape');
  await expect(guide).toBeHidden();
  const marker = await page.evaluate(
    () => localStorage.getItem('cerberus.onboarding.v1') ?? '',
  );
  expect(marker).toContain('dismissedAt');

  // A fresh load does not reopen the guide once dismissed.
  await page.goto('/');
  await expect(page.getByRole('dialog', { name: 'Learning guide' })).toBeHidden();

  // The guide is reopenable from the sidebar utility rail.
  await page.getByRole('button', { name: 'Reopen the learning guide' }).click();
  await expect(page.getByRole('dialog', { name: 'Learning guide' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Welcome to CERBERUS' })).toBeVisible();
});
