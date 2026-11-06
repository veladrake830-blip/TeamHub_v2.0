# Running TeamHub

Requires Node 26 and PostgreSQL 18. The requirements are in [Readme.md](../Readme.md).

## First-time setup

```bash
npm install
npm run setup
```

`npm run setup` does the following:
1. Creates a private development database in `.devdb/`, on port 55432. Your main PostgreSQL server is not touched.
2. Writes `server/.env` with generated secrets.
3. Generates the Prisma client and applies the migrations.
4. Creates the Admin, and prints the generated password once.

If PostgreSQL isn't in `C:/Program Files/PostgreSQL/18/bin`, set `PG_BIN` to its `bin` folder first.

To use your own PostgreSQL server instead, copy `server/.env.example` to `server/.env`, fill in `DATABASE_URL`, `TEST_DATABASE_URL` and `JWT_SECRET`, then run:

```bash
npm run db:generate -w server
npm run db:migrate
npm run db:seed
```

## Daily use

Start the database after a reboot:

```bash
npm run db:start
```

Run the server and the client, each in its own terminal:

```bash
npm run dev:server
```

```bash
npm run dev:client
```

Open http://localhost:5173.

## Tests

The tests rebuild the database named in `TEST_DATABASE_URL`, and refuse to run unless its name ends in `_test`.

```bash
npm test
```

## Production

```bash
npm run build
npm start
```

The server hosts the built client on `PORT`. Set `PUBLIC_URL` to the address users open, because reset links are built from it. Behind HTTPS, set `COOKIE_SECURE=true`.

Backups must cover both the database and `UPLOAD_DIR`, where avatars are stored.

## If the Admin loses their password

Run this on the server. With no password argument, it generates one and prints it once.

```bash
npm run admin:reset-password -w server -- "new password"
```
