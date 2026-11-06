import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Prisma's CLI does not load .env by itself.
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
