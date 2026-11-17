import { test as base, expect } from '@playwright/test';
import { ONBOARDING_STORAGE_KEY } from '../../src/lib/onboarding';

export { expect };

/**
 * Shared E2E fixture: marks the interactive Learning Guide as already completed
 * so legacy specs are not blocked by the onboarding overlay.
 * Specs that deliberately exercise the guide (onboarding.spec.ts) use the raw
 * `@playwright/test` test instead.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(
      ({ key }) => {
        try {
          localStorage.setItem(key, JSON.stringify({ '*': { completedAt: 1 } }));
        } catch {
          // storage unavailable — guide may open; unrelated to these specs
        }
      },
      { key: ONBOARDING_STORAGE_KEY },
    );
    await use(page);
  },
});
