import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const prepared = JSON.parse(readFileSync(path.resolve('tests/e2e/.auth/prepared.json'), 'utf8')) as {
  storage: { admin: string };
};

test.use({ storageState: prepared.storage.admin });

test('exposes accessible planning tabs with keyboard navigation', async ({ page }) => {
  await page.goto('/planning');
  await expect(page.getByRole('heading', { name: 'Planning & capacity' })).toBeVisible();

  const tablist = page.getByRole('tablist', { name: 'Planning views' });
  await expect(tablist).toBeVisible();

  const weekTab = page.getByRole('tab', { name: 'My Week' });
  await expect(weekTab).toHaveAttribute('aria-selected', 'true');
  await expect(weekTab).toHaveAttribute('tabindex', '0');
  await expect(page.getByRole('heading', { name: /'s week$/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Scheduled this week' })).toBeVisible();

  const calendarTab = page.getByRole('tab', { name: 'Calendar' });
  const timelineTab = page.getByRole('tab', { name: 'Timeline' });
  const workloadTab = page.getByRole('tab', { name: 'Workload' });
  await expect(calendarTab).toHaveAttribute('tabindex', '-1');

  await weekTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(calendarTab).toHaveAttribute('aria-selected', 'true');
  await expect(calendarTab).toBeFocused();
  const calendar = page.getByRole('grid', { name: 'Task calendar' });
  await expect(calendar).toBeVisible();
  await expect(calendar.getByRole('columnheader')).toHaveCount(7);
  await expect(calendar.getByRole('gridcell', { name: /\d/ }).first()).toBeVisible();

  await page.keyboard.press('ArrowRight');
  await expect(timelineTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Dependency timeline' })).toBeVisible();

  await page.keyboard.press('End');
  await expect(workloadTab).toHaveAttribute('aria-selected', 'true');
  await expect(workloadTab).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Capacity & workload' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'From', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'To', exact: true })).toBeVisible();

  await page.keyboard.press('Home');
  await expect(weekTab).toHaveAttribute('aria-selected', 'true');

  await calendarTab.click();
  await page.keyboard.press('ArrowLeft');
  await expect(weekTab).toHaveAttribute('aria-selected', 'true');
});

test('logs effort on a task and surfaces it in the weekly ledger', async ({ page }) => {
  const note = `E2E effort ${Date.now()}`;

  await page.goto('/tasks/task_1_1');
  await expect(page.getByRole('heading', { name: 'Effort ledger & schedule' })).toBeVisible();

  const form = page.getByRole('form', { name: 'Log effort on this task' });
  await form.getByLabel('Hours').fill('2');
  await form.getByLabel('Note').fill(note);
  await form.getByRole('button', { name: 'Log hours' }).click();

  await expect(page.getByText(note)).toBeVisible();

  await page.goto('/planning');
  await expect(page.getByRole('heading', { name: 'Logged effort' })).toBeVisible();
  await expect(page.getByText(note)).toBeVisible();
});
