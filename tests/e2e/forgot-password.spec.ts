import { expect, test } from '@playwright/test';

test('requests recovery without disclosing whether the account exists', async ({ page }) => {
  await page.goto('/forgot-password');
  await page.getByLabel('Email address').fill('mostafa@cerberus.local');
  await page.getByRole('button', { name: /Request reset link/ }).click();

  await expect(page.getByRole('heading', { name: 'Request received' })).toBeVisible();
  await expect(page.getByText(/one-time reset link|administrator has been notified/)).toBeVisible();
  await expect(page.getByRole('link', { name: /Return to sign in/ })).toBeVisible();
});
