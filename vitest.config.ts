import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    exclude: [...configDefaults.exclude, 'tests/integration/**', 'tests/e2e/**'],
    coverage: { reporter: ['text', 'json', 'html'] },
  },
});
