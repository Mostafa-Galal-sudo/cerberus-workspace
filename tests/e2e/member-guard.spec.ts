import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const prepared = JSON.parse(readFileSync(path.resolve('tests/e2e/.auth/prepared.json'), 'utf8')) as {
  storage: { member: string };
};

test.use({ storageState: prepared.storage.member });

test('member accounts cannot open the administrative command center', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Wessam');
});
