# Deploying TeamHub

The hosting choice is still open (see section 6 of [Readme.md](../Readme.md)). This guide works for any single server with Node 26 and PostgreSQL 18. The app needs no other services.

## Before the first launch

These need a decision from you:

| Decision | Why it matters |
|---|---|
| Where it runs | Avatars are stored on local disk, so the server needs a disk that survives restarts. |
| HTTPS or plain HTTP | Over plain HTTP, passwords and sessions can be read on the network. Use HTTPS unless the network is fully trusted. |
| The organization timezone | It starts as `Europe/Moscow`. The Admin changes it under Settings. |
| The Admin's email | It's set once, when the Admin is created. |
| Who handles backups | The script makes a copy, but someone must schedule it and move it off the server. |

## Install

1. Create a database and a user for TeamHub in PostgreSQL. Don't use the `postgres` superuser.
2. Get the code, then install it:

   ```bash
   npm ci
   npm run db:generate -w server
   ```

3. Copy `server/.env.example` to `server/.env`, and set the values below.
4. Prepare the database, then build:

   ```bash
   npm run db:migrate
   npm run db:seed
   npm run build
   ```

5. If you left `ADMIN_PASSWORD` empty, `db:seed` prints a generated password once. If you set it, remove it from `server/.env` after seeding.
6. Log in as the Admin, and change the password under your profile.

## Settings in `server/.env`

| Setting | Value |
|---|---|
| `DATABASE_URL` | The connection string for the TeamHub database. |
| `JWT_SECRET` | A long random value. Generate one with `openssl rand -hex 32`. The server refuses to start with a weak value. Changing it logs users out within 15 minutes, at their next token refresh. |
| `PUBLIC_URL` | The address users open. Reset links are built from this, so a wrong value gives broken links. |
| `PORT` | The port the app listens on. |
| `HOST` | The address the app listens on. Set `127.0.0.1` behind a reverse proxy on the same server, so that nothing can reach the app directly. |
| `UPLOAD_DIR` | Where avatars are stored. Use an absolute path outside the code folder. |
| `COOKIE_SECURE` | `true` when users reach the site over HTTPS, and `false` on plain HTTP. If this is wrong, users can't stay logged in over HTTP, or the session cookie is not protected over HTTPS. |
| `TRUST_PROXY` | The number of reverse proxies in front of the app. Use `0` if there are none, and usually `1` with nginx, IIS or a load balancer. If this is too low, all users appear to share one address in the audit log and rate limits. If it is too high, clients can fake their address. |

`TEST_DATABASE_URL` isn't needed in production.

## Run

```bash
npm start
```

The server hosts both the API and the client on `PORT`. Use your platform's service manager so it restarts after a crash or reboot, such as systemd on Linux or a scheduled task or service wrapper on Windows.

For HTTPS, put a reverse proxy such as nginx or IIS in front of the app, then set `COOKIE_SECURE=true`, `TRUST_PROXY=1` and `HOST=127.0.0.1`.

## Backups

```bash
npm run backup
```

This writes the database and uploaded files to `backups/<timestamp>/`. Set `PG_BIN` if `pg_dump` isn't on the path, and `BACKUP_DIR` to choose another location. The folder contains all user data and password hashes, so protect it.

Run this daily on a schedule, and copy the result to another machine. A backup kept only on the server is lost along with the server.

### Restoring

Restore into a new, empty database, because the audit log's protection rules block overwriting existing entries.

```bash
createdb teamhub_restored
pg_restore --no-owner --dbname=teamhub_restored backups/<timestamp>/database.dump
```

Point `DATABASE_URL` at the restored database, and copy `uploads` from the backup back to `UPLOAD_DIR`. Test a restore before you need one.

## Updating

1. Run a backup.
2. Stop the server.
3. Get the new code, then run:

   ```bash
   npm ci
   npm run db:generate -w server
   npm run db:migrate
   npm run build
   ```

4. Start the server.

Migrations only move forward. To undo an update, restore the backup.

## If something goes wrong

| Problem | Likely cause |
|---|---|
| The server won't start and mentions `JWT_SECRET` | It's missing, still the example value, or under 32 characters. |
| Users are logged out on every reload | `COOKIE_SECURE=true` on a plain HTTP site. |
| Reset links point at the wrong address | `PUBLIC_URL` is wrong. |
| Avatars disappear after an update | `UPLOAD_DIR` is inside a folder that gets replaced. |
| The Admin lost their password | Run `npm run admin:reset-password -w server` on the server. |
| A user is locked out after failed logins | Wait 15 minutes. The limit is 10 attempts per account per address. |
