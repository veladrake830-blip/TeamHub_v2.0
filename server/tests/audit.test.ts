import { describe, expect, it, vi } from 'vitest';
import { auditEntries, createTeam, createUser, db, getAdmin, loginAs, uniqueEmail } from './helpers.ts';

describe('audit log immutability', () => {
  const anEntry = () => db.auditLog.create({ data: { action: 'TEST_ENTRY' } });

  it('rejects updates', async () => {
    const entry = await anEntry();
    await expect(db.auditLog.update({ where: { id: entry.id }, data: { action: 'CHANGED' } })).rejects.toThrow();
  });

  it('rejects deletes', async () => {
    const entry = await anEntry();
    await expect(db.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow();
  });

  it('rejects truncation', async () => {
    await expect(db.$executeRawUnsafe('TRUNCATE "AuditLog"')).rejects.toThrow();
  });
});

describe('audit records', () => {
  it('include the Admin\'s own actions, with who and what', async () => {
    const admin = await loginAs(await getAdmin());
    const email = uniqueEmail();
    const res = await admin.post('/api/users', { name: 'Audited', email }).expect(201);
    const [entry] = await auditEntries('ACCOUNT_ADDED', res.body.id);
    expect(entry?.actorId).toBe(admin.id);
    expect(entry?.actorName).toBe('Admin');
  });

  it('are written with the change, so a failed change leaves no record', async () => {
    const admin = await loginAs(await getAdmin());
    const duplicate = await createTeam();
    const leader = await createUser();
    const before = await db.auditLog.count({ where: { action: 'TEAM_CREATED' } });
    await admin.post('/api/teams', { name: duplicate.name, leaderId: leader.id }).expect(409);
    expect(await db.auditLog.count({ where: { action: 'TEAM_CREATED' } })).toBe(before);
  });

  it('roll the change back if the record cannot be written', async () => {
    const admin = await loginAs(await getAdmin());
    const user = await createUser({ status: 'PENDING' });
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    await db.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_block_audit() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'audit unavailable'; END; $$ LANGUAGE plpgsql;
      `);
    await db.$executeRawUnsafe(
      'CREATE TRIGGER test_block BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION test_block_audit()',
    );
    try {
      await admin.post(`/api/users/${user.id}/activate`).expect(500);
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER test_block ON "AuditLog"');
      quiet.mockRestore();
    }
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe('PENDING');
  });
});
