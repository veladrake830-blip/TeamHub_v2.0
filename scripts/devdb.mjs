// Runs a private PostgreSQL cluster for development, stored in .devdb/.
// It uses the installed PostgreSQL binaries but never touches any other server.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dataDir = join(root, '.devdb', 'data');
const logFile = join(root, '.devdb', 'postgres.log');
const envFile = join(root, 'server', '.env');
const port = process.env.DEVDB_PORT ?? '55432';
const bin = process.env.PG_BIN ?? 'C:/Program Files/PostgreSQL/18/bin';
const exe = (name) => join(bin, process.platform === 'win32' ? `${name}.exe` : name);
const run = (name, args, opts = {}) => execFileSync(exe(name), args, { stdio: 'inherit', ...opts });

function isRunning() {
  try {
    execFileSync(exe('pg_ctl'), ['status', '-D', dataDir], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function start() {
  if (isRunning()) return console.log(`Dev database already running on port ${port}.`);
  // stdio is ignored so the server does not hold the caller's output open.
  run('pg_ctl', ['start', '-w', '-D', dataDir, '-l', logFile, '-o', `-p ${port} -c listen_addresses=localhost`], { stdio: 'ignore' });
  console.log(`Dev database started on port ${port}.`);
}

function init() {
  if (existsSync(dataDir)) {
    console.log('Dev database already initialized.');
    return start();
  }
  mkdirSync(dataDir, { recursive: true });
  const password = randomBytes(18).toString('hex');
  const pwFile = join(root, '.devdb', 'pwfile');
  writeFileSync(pwFile, password);
  run('initdb', ['-D', dataDir, '-U', 'teamhub', `--pwfile=${pwFile}`, '-A', 'scram-sha-256', '-E', 'UTF8', '--locale=C']);
  rmSync(pwFile);
  start();
  const env = { ...process.env, PGPASSWORD: password };
  for (const db of ['teamhub', 'teamhub_test']) {
    run('createdb', ['-h', 'localhost', '-p', port, '-U', 'teamhub', db], { env });
  }
  const url = (db) => `postgresql://teamhub:${password}@localhost:${port}/${db}`;
  const secret = () => randomBytes(32).toString('hex');
  const example = readFileSync(join(root, 'server', '.env.example'), 'utf8');
  writeFileSync(
    envFile,
    example
      .replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${url('teamhub')}`)
      .replace(/^TEST_DATABASE_URL=.*$/m, `TEST_DATABASE_URL=${url('teamhub_test')}`)
      .replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${secret()}`),
  );
  console.log(`Dev database ready on port ${port}. Wrote server/.env.`);
}

function stop() {
  if (!isRunning()) return console.log('Dev database is not running.');
  run('pg_ctl', ['stop', '-w', '-D', dataDir]);
}

const commands = { init, start, stop };
const command = commands[process.argv[2]];
if (!command) {
  console.error('Usage: node scripts/devdb.mjs <init|start|stop>');
  process.exit(1);
}
command();
