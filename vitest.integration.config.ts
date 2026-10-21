import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./db/migrations');

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.test.jsonc' },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations },
        },
      }),
    ],
    test: {
      include: ['tests/integration/**/*.test.ts'],
      setupFiles: ['./tests/integration/setup.ts'],
      testTimeout: 20000,
      hookTimeout: 30000,
    },
  };
});
