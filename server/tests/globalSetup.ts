import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { Client } from 'pg';

/** Rebuilds the test database from the real migrations before each run. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? '';
  // This wipes the database, so refuse anything that is not plainly a test database.
  if (!new URL(url).pathname.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point at a database whose name ends in _test.');
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query('DROP SCHEMA public CASCADE');
  await client.query('CREATE SCHEMA public');
  await client.end();

  execFileSync('npx prisma migrate deploy', {
    shell: true,
    stdio: 'ignore',
    env: { ...process.env, DATABASE_URL: url },
  });
  return () => rmSync('tests/.uploads', { recursive: true, force: true });
}
