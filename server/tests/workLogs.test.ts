import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, dayIn, withinEditWindow } from '../src/lib/dates.ts';
import { auditEntries, addMember, createTeam, createUser, db, getAdmin, loginAs, type Client } from './helpers.ts';

describe('calendar days', () => {
  // 2026-03-10 22:30 UTC is already 11 March in Moscow, but still 10 March in New York.
  const instant = new Date('2026-03-10T22:30:00Z');

  it('depend on the timezone, not on the server', () => {
    expect(dayIn('Europe/Moscow', instant)).toBe('2026-03-11');
    expect(dayIn('America/New_York', instant)).toBe('2026-03-10');
    expect(dayIn('UTC', instant)).toBe('2026-03-10');
  });

  it('roll over months, years and leap days', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('stay editable until the end of the following day', () => {
    expect(withinEditWindow('2026-03-11', '2026-03-11')).toBe(true);
    expect(withinEditWindow('2026-03-10', '2026-03-11')).toBe(true);
    expect(withinEditWindow('2026-03-09', '2026-03-11')).toBe(false);
    expect(withinEditWindow('2026-03-12', '2026-03-11')).toBe(false);
  });

  it('lock at exactly midnight in the organization timezone', () => {
    const plan = '2026-03-10';
    const lastMinute = new Date('2026-03-11T20:59:59Z'); // 23:59:59 on the 11th in Moscow
    const midnight = new Date('2026-03-11T21:00:00Z'); // 00:00:00 on the 12th in Moscow
    expect(withinEditWindow(plan, dayIn('Europe/Moscow', lastMinute))).toBe(true);
    expect(withinEditWindow(plan, dayIn('Europe/Moscow', midnight))).toBe(false);
  });
});

const tasks = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ title: `Task ${i + 1}`, result: '' }));

let admin: Client;
let member: Client;
let leader: Client;
let noTeam: Client;
let teamId: string;
let today: string;
let yesterday: string;

beforeAll(async () => {
  admin = await loginAs(await getAdmin());
  const team = await createTeam();
  teamId = team.id;
  const memberUser = await createUser({ name: 'Plan Member' });
  const leaderUser = await createUser({ name: 'Plan Leader' });
  await addMember(memberUser.id, team.id);
  await addMember(leaderUser.id, team.id, 'TEAM_LEADER');
  member = await loginAs(memberUser);
  leader = await loginAs(leaderUser);
  noTeam = await loginAs(await createUser());
  const settings = await admin.get('/api/settings/organization').expect(200);
  today = settings.body.today;
  yesterday = addDays(today, -1);
});

async function newMember() {
  const user = await createUser();
  await addMember(user.id, teamId);
  return loginAs(user);
}

/** Stored directly, because the API refuses to create a plan this old. */
async function oldPlan(userId: string, daysAgo: number) {
  return db.workPlan.create({
    data: {
      userId,
      date: new Date(`${addDays(today, -daysAgo)}T00:00:00Z`),
      tasks: { create: tasks(2).map((task, position) => ({ ...task, position })) },
    },
  });
}

describe('recording a plan', () => {
  it('allows TeamLeaders and Members, for today and yesterday', async () => {
    const res = await member.post('/api/work-logs', { date: today, tasks: tasks(2) }).expect(201);
    expect(res.body.canEdit).toBe(true);
    await member.post('/api/work-logs', { date: yesterday, tasks: tasks(5) }).expect(201);
    await leader.post('/api/work-logs', { date: today, tasks: tasks(3) }).expect(201);
  });

  it('refuses the Admin and users without a team', async () => {
    await admin.post('/api/work-logs', { date: today, tasks: tasks(2) }).expect(403);
    await noTeam.post('/api/work-logs', { date: today, tasks: tasks(2) }).expect(403);
  });

  it.each([1, 6])('refuses %i tasks', async (count) => {
    const client = await newMember();
    await client.post('/api/work-logs', { date: today, tasks: tasks(count) }).expect(400);
  });

  it('refuses a blank task title', async () => {
    const client = await newMember();
    const blank = [{ title: 'Real' }, { title: '   ' }];
    await client.post('/api/work-logs', { date: today, tasks: blank }).expect(400);
  });

  it('refuses days other than today and yesterday', async () => {
    const client = await newMember();
    await client.post('/api/work-logs', { date: addDays(today, 1), tasks: tasks(2) }).expect(400);
    await client.post('/api/work-logs', { date: addDays(today, -2), tasks: tasks(2) }).expect(400);
  });

  it('refuses an impossible date', async () => {
    const client = await newMember();
    await client.post('/api/work-logs', { date: '2026-02-31', tasks: tasks(2) }).expect(400);
  });

  it('allows one plan per person per day, even for simultaneous requests', async () => {
    const client = await newMember();
    const body = { date: today, tasks: tasks(2) };
    const results = await Promise.all([client.post('/api/work-logs', body), client.post('/api/work-logs', body)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it('cannot be created for someone else', async () => {
    const client = await newMember();
    await client.post('/api/work-logs', { userId: member.id, date: today, tasks: tasks(2) }).expect(400);
  });
});

describe('editing a plan', () => {
  it('saves results and task changes, keeping the order', async () => {
    const client = await newMember();
    const created = await client.post('/api/work-logs', { date: today, tasks: tasks(2) }).expect(201);
    const updated = await client
      .put(`/api/work-logs/${created.body.id}`, {
        tasks: [
          { title: 'Second first', result: 'Done' },
          { title: 'Task 1', result: '' },
          { title: 'New', result: 'Blocked' },
        ],
      })
      .expect(200);
    expect(updated.body.tasks.map((t: { title: string }) => t.title)).toEqual(['Second first', 'Task 1', 'New']);
    expect(updated.body.tasks[0].result).toBe('Done');
  });

  it('keeps the existing tasks when an update is invalid', async () => {
    const client = await newMember();
    const created = await client.post('/api/work-logs', { date: today, tasks: tasks(2) }).expect(201);
    await client.put(`/api/work-logs/${created.body.id}`, { tasks: tasks(1) }).expect(400);
    expect(await db.workTask.count({ where: { planId: created.body.id } })).toBe(2);
  });

  it('works for yesterday, and locks the day before that', async () => {
    const client = await newMember();
    const open = await oldPlan(client.id, 1);
    const locked = await oldPlan(client.id, 2);
    await client.put(`/api/work-logs/${open.id}`, { tasks: tasks(3) }).expect(200);
    const res = await client.put(`/api/work-logs/${locked.id}`, { tasks: tasks(3) }).expect(403);
    expect(res.body.error.code).toBe('PLAN_LOCKED');
  });

  it('is limited to the owner, even for the Admin and TeamLeaders', async () => {
    const client = await newMember();
    const created = await client.post('/api/work-logs', { date: today, tasks: tasks(2) }).expect(201);
    const url = `/api/work-logs/${created.body.id}`;
    await admin.put(url, { tasks: tasks(2) }).expect(403);
    await leader.put(url, { tasks: tasks(2) }).expect(403);
    await noTeam.put(url, { tasks: tasks(2) }).expect(403);
  });

  it('becomes read-only at once when the user leaves their last team', async () => {
    const client = await newMember();
    const created = await client.post('/api/work-logs', { date: today, tasks: tasks(2) }).expect(201);
    await client.post(`/api/teams/${teamId}/leave`).expect(204);

    await client.put(`/api/work-logs/${created.body.id}`, { tasks: tasks(3) }).expect(403);
    await client.post('/api/work-logs', { date: yesterday, tasks: tasks(2) }).expect(403);

    const list = await client.get(`/api/work-logs?userId=${client.id}`).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].canEdit).toBe(false);
    expect(list.body.canRecord).toBe(false);

    await addMember(client.id, teamId);
    await client.put(`/api/work-logs/${created.body.id}`, { tasks: tasks(3) }).expect(200);
  });
});

describe('reading work logs', () => {
  it('is open to every logged-in user, on all plans', async () => {
    const client = await newMember();
    await client.post('/api/work-logs', { date: today, tasks: tasks(2) }).expect(201);
    for (const viewer of [admin, leader, member, noTeam]) {
      const res = await viewer.get(`/api/work-logs?userId=${client.id}`).expect(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].canEdit).toBe(false);
    }
  });

  it('defaults to today, and can show another day', async () => {
    const res = await noTeam.get('/api/work-logs?pageSize=100').expect(200);
    expect(res.body.today).toBe(today);
    expect(res.body.items.every((p: { date: string }) => p.date === today)).toBe(true);
    const old = await noTeam.get(`/api/work-logs?date=${addDays(today, -30)}`).expect(200);
    expect(old.body.items).toHaveLength(0);
  });

  it('filters by team', async () => {
    const other = await createTeam();
    const empty = await noTeam.get(`/api/work-logs?teamId=${other.id}`).expect(200);
    expect(empty.body.items).toHaveLength(0);
    const full = await noTeam.get(`/api/work-logs?teamId=${teamId}`).expect(200);
    expect(full.body.items.length).toBeGreaterThan(0);
  });

  it('keeps a deactivated user\'s plans visible', async () => {
    const client = await newMember();
    await client.post('/api/work-logs', { date: today, tasks: tasks(2) }).expect(201);
    await admin.post(`/api/users/${client.id}/deactivate`).expect(204);
    const res = await noTeam.get(`/api/work-logs?userId=${client.id}`).expect(200);
    expect(res.body.items[0].user.deactivated).toBe(true);
  });

  it('needs a login', async () => {
    const { default: request } = await import('supertest');
    const { app } = await import('./helpers.ts');
    await request(app).get('/api/work-logs').expect(401);
  });
});

describe('organization timezone', () => {
  const restore = () => admin.put('/api/settings/organization', { timezone: 'Europe/Moscow' }).expect(200);
  afterAll(restore);

  it('can be read by anyone and changed only by the Admin', async () => {
    await noTeam.get('/api/settings/organization').expect(200);
    await leader.put('/api/settings/organization', { timezone: 'UTC' }).expect(403);
    await member.put('/api/settings/organization', { timezone: 'UTC' }).expect(403);
    await noTeam.put('/api/settings/organization', { timezone: 'UTC' }).expect(403);
  });

  it('rejects an unknown timezone', async () => {
    await admin.put('/api/settings/organization', { timezone: 'Mars/Olympus' }).expect(400);
  });

  it('records a change in the audit log', async () => {
    await admin.put('/api/settings/organization', { timezone: 'Asia/Tokyo' }).expect(200);
    const entries = await auditEntries('TIMEZONE_CHANGED');
    expect(entries.at(-1)?.details).toMatchObject({ to: 'Asia/Tokyo' });
    await restore();
  });

  it('changes which day counts as today', async () => {
    const zones = ['Pacific/Kiritimati', 'Pacific/Pago_Pago']; // UTC+14 and UTC-11, always different days
    const days = [];
    for (const timezone of zones) {
      const res = await admin.put('/api/settings/organization', { timezone }).expect(200);
      days.push(res.body.today);
    }
    expect(days[0]).not.toBe(days[1]);
    await restore();
  });
});
