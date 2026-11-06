import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

if (existsSync('.env')) process.loadEnvFile('.env');
if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is not set.');

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/globalSetup.ts'],
    // All files share one database and one Admin account.
    fileParallelism: false,
    testTimeout: 20_000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      BCRYPT_COST: '4',
      RATE_LIMIT: 'off',
      UPLOAD_DIR: 'tests/.uploads',
    },
  },
});
