import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, createTeam, createUser, db, getAdmin, loginAs, uniqueEmail, type Client } from './helpers.ts';

let admin: Client;
beforeAll(async () => {
  admin = await loginAs(await getAdmin());
});

describe('who can see the Admin area', () => {
  it.each(['/api/admin/audit', '/api/admin/audit/actions', '/api/admin/summary'])('%s', async (url) => {
    const team = await createTeam();
    const leader = await createUser();
    const member = await createUser();
    await addMember(leader.id, team.id, 'TEAM_LEADER');
    await addMember(member.id, team.id);
    await (await loginAs(leader)).get(url).expect(403);
    await (await loginAs(member)).get(url).expect(403);
    await (await loginAs(await createUser())).get(url).expect(403);
    await admin.get(url).expect(200);
  });
});

describe('audit log viewer', () => {
  it('shows newest first, with actor and current target name', async () => {
    const created = await admin.post('/api/users', { name: 'Viewer Target', email: uniqueEmail() }).expect(201);
    const res = await admin.get('/api/admin/audit?limit=1').expect(200);
    expect(res.body.items[0]).toMatchObject({
      action: 'ACCOUNT_ADDED',
      actorName: 'Admin',
      targetId: created.body.id,
      targetName: 'Viewer Target',
    });
    expect(typeof res.body.items[0].id).toBe('string');
  });

  it('pages through entries without gaps or repeats', async () => {
    for (let i = 0; i < 5; i++) await db.auditLog.create({ data: { action: 'PAGING_TEST' } });
    const first = await admin.get('/api/admin/audit?action=PAGING_TEST&limit=3').expect(200);
    expect(first.body.items).toHaveLength(3);
    expect(first.body.nextBefore).toBeTruthy();
    const second = await admin
      .get(`/api/admin/audit?action=PAGING_TEST&limit=3&before=${first.body.nextBefore}`)
      .expect(200);
    expect(second.body.items).toHaveLength(2);
    expect(second.body.nextBefore).toBeNull();
    const ids = [...first.body.items, ...second.body.items].map((e: { id: string }) => e.id);
    expect(new Set(ids).size).toBe(5);
  });

  it('filters by action, actor and date', async () => {
    await db.auditLog.create({ data: { action: 'FILTER_TEST', actorName: 'Findable Person' } });
    const byActor = await admin.get('/api/admin/audit?actor=findable').expect(200);
    expect(byActor.body.items.every((e: { actorName: string }) => e.actorName === 'Findable Person')).toBe(true);
    expect(byActor.body.items.length).toBeGreaterThan(0);

    const future = new Date(Date.now() + 86_400_000).toISOString();
    const none = await admin.get(`/api/admin/audit?action=FILTER_TEST&from=${future}`).expect(200);
    expect(none.body.items).toHaveLength(0);
    const before = await admin.get(`/api/admin/audit?action=FILTER_TEST&to=${future}`).expect(200);
    expect(before.body.items.length).toBeGreaterThan(0);
  });

  it('rejects invalid filters', async () => {
    await admin.get('/api/admin/audit?from=not-a-date').expect(400);
    await admin.get('/api/admin/audit?before=abc').expect(400);
    await admin.get('/api/admin/audit?limit=1000').expect(400);
  });

  it('offers no way to change entries', async () => {
    const res = await admin.get('/api/admin/audit?limit=1').expect(200);
    const url = `/api/admin/audit/${res.body.items[0].id}`;
    await admin.delete(url).expect(404);
    await admin.patch(url, { action: 'X' }).expect(404);
  });

  it('lists the actions that have occurred', async () => {
    await db.auditLog.create({ data: { action: 'LISTED_ACTION' } });
    const res = await admin.get('/api/admin/audit/actions').expect(200);
    expect(res.body).toContain('LISTED_ACTION');
  });
});

describe('dashboard summary', () => {
  it('lists pending accounts until they are activated', async () => {
    const pending = await createUser({ status: 'PENDING' });
    const before = await admin.get('/api/admin/summary').expect(200);
    expect(before.body.pending.map((u: { id: string }) => u.id)).toContain(pending.id);
    await admin.post(`/api/users/${pending.id}/activate`).expect(204);
    const after = await admin.get('/api/admin/summary').expect(200);
    expect(after.body.pending.map((u: { id: string }) => u.id)).not.toContain(pending.id);
    expect(after.body.counts.pending).toBe(before.body.counts.pending - 1);
  });

  it('lists a team as leaderless once its last leader is deactivated', async () => {
    const team = await createTeam();
    const leader = await createUser();
    await addMember(leader.id, team.id, 'TEAM_LEADER');
    const ids = async () =>
      (await admin.get('/api/admin/summary').expect(200)).body.leaderlessTeams.map((t: { id: string }) => t.id);
    expect(await ids()).not.toContain(team.id);
    await admin.post(`/api/users/${leader.id}/deactivate`).expect(204);
    expect(await ids()).toContain(team.id);
  });

  it('includes recent activity', async () => {
    const res = await admin.get('/api/admin/summary').expect(200);
    expect(res.body.recentActivity.length).toBeGreaterThan(0);
    expect(res.body.recentActivity.length).toBeLessThanOrEqual(10);
  });
});
