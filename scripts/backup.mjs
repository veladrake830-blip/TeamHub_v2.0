// Backs up the database and uploaded files into backups/<timestamp>/.
// Both are needed: the database refers to avatar files by name.
// Run it on a schedule, and copy the result off this machine.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const serverDir = join(root, 'server');
if (existsSync(join(serverDir, '.env'))) process.loadEnvFile(join(serverDir, '.env'));

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set.');

const bin = process.env.PG_BIN;
const pgDump = bin ? join(bin, process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump') : 'pg_dump';

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = resolve(process.env.BACKUP_DIR ?? join(root, 'backups'), stamp);
mkdirSync(target, { recursive: true });

// The password goes through the environment, so it can't appear in process listings.
const url = new URL(databaseUrl);
const password = decodeURIComponent(url.password);
url.password = '';
const dumpFile = join(target, 'database.dump');
execFileSync(pgDump, ['--format=custom', `--file=${dumpFile}`, `--dbname=${url}`], {
  stdio: 'inherit',
  env: { ...process.env, PGPASSWORD: password },
});

const uploads = resolve(serverDir, process.env.UPLOAD_DIR ?? 'uploads');
if (existsSync(uploads)) cpSync(uploads, join(target, 'uploads'), { recursive: true });

console.log(`Backup written to ${target}`);
