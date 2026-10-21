import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const prepared = JSON.parse(readFileSync(path.resolve('tests/e2e/.auth/prepared.json'), 'utf8')) as {
  storage: { admin: string };
};

test.use({ storageState: prepared.storage.admin });

test('administrator transfers task ownership from the member directory', async ({ page }) => {
  await page.goto('/members');
  await expect(page.getByRole('heading', { name: 'Engineering Directory' })).toBeVisible();

  await page.getByRole('button', { name: /Wessam/ }).click();
  await page.getByRole('button', { name: 'Reassign work' }).click();
  await expect(page.getByRole('heading', { name: 'Reassign work' })).toBeVisible();
  await expect(page.getByText(/Tasks \(\d+\/5\)/)).toBeVisible();

  const target = page.locator('.modal-card select');
  const firstTarget = await target.locator('option').nth(1).getAttribute('value');
  expect(firstTarget).toBeTruthy();
  await target.selectOption(firstTarget!);
  await page.locator('.modal-card input[type="checkbox"]').first().check();
  await page.getByRole('button', { name: 'Transfer selected work' }).click();

  await expect(page.getByText(/Transferred \d+ task\(s\) and \d+ checkpoint\(s\)/)).toBeVisible();
});

test('uploads, downloads and archives private task evidence', async ({ page }) => {
  await page.goto('/tasks/task_1_1');
  await expect(page.getByRole('heading', { name: 'Deliver Embedded foundation' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Evidence attachments' })).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    name: 'e2e-evidence.log',
    mimeType: 'text/plain',
    buffer: Buffer.from('E2E telemetry evidence captured by Playwright.'),
  });
  await page.getByPlaceholder('Optional evidence label').fill('E2E evidence bundle');
  await page.getByRole('button', { name: 'Attach evidence' }).click();

  await expect(page.getByText('1 private attachment')).toBeVisible();
  await expect(page.getByText('E2E evidence bundle')).toBeVisible();
  await expect(page.getByRole('link', { name: /Download/ })).toBeVisible();

  await page.getByTitle('Archive attachment').click();
  await expect(page.getByText('0 private attachments')).toBeVisible();
});

test('downloads a server-rendered PDF report', async ({ page }) => {
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'System Reports & PDF Artifacts' })).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: /Download server PDF/ }).click();
  const download = await downloadPromise;
  const filename = download.suggestedFilename();
  expect(filename).toMatch(/^cerberus-progress-\d{4}-\d{2}-\d{2}\.pdf$/);

  const filePath = await download.path();
  expect(filePath).toBeTruthy();
  const bytes = readFileSync(filePath!);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
});
