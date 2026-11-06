import { beforeAll, describe, expect, it } from 'vitest';
import { addDays } from '../src/lib/dates.ts';
import { addMember, createTeam, createUser, db, getAdmin, loginAs, type Client } from './helpers.ts';

let admin: Client;
let leader: Client;
let noTeam: Client;
let teamId: string;
let today: string;
let yesterday: string;

const entry = (date: string, extra: object = {}) => ({
  date,
  start: '09:00',
  end: '10:30',
  category: 'Development',
  ...extra,
});

async function newMember(team = teamId, name = 'Time Member') {
  const user = await createUser({ name });
  await addMember(user.id, team);
  return loginAs(user);
}

/** Stored directly, because the API refuses days this old. */
const oldEntry = (userId: string, daysAgo: number) =>
  db.activityEntry.create({
    data: {
      userId,
      date: new Date(`${addDays(today, -daysAgo)}T00:00:00Z`),
      startMinute: 60,
      endMinute: 120,
      category: 'Old',
    },
  });

beforeAll(async () => {
  admin = await loginAs(await getAdmin());
  const team = await createTeam();
  teamId = team.id;
  const leaderUser = await createUser();
  await addMember(leaderUser.id, team.id, 'TEAM_LEADER');
  leader = await loginAs(leaderUser);
  noTeam = await loginAs(await createUser());
  today = (await admin.get('/api/settings/organization').expect(200)).body.today;
  yesterday = addDays(today, -1);
});

describe('recording time', () => {
  it('lets TeamLeaders and Members record their own, with the fields returned', async () => {
    const member = await newMember();
    const res = await member
      .post('/api/activity/entries', entry(today, { note: 'Login work' }))
      .expect(201);
    expect(res.body).toMatchObject({
      start: '09:00',
      end: '10:30',
      minutes: 90,
      category: 'Development',
      note: 'Login work',
      source: 'MANUAL',
      canEdit: true,
    });
    await leader.post('/api/activity/entries', entry(yesterday)).expect(201);
  });

  it('refuses the Admin and users without a team', async () => {
    await admin.post('/api/activity/entries', entry(today)).expect(403);
    await noTeam.post('/api/activity/entries', entry(today)).expect(403);
  });

  it('refuses other days', async () => {
    const member = await newMember();
    await member.post('/api/activity/entries', entry(addDays(today, 1))).expect(400);
    await member.post('/api/activity/entries', entry(addDays(today, -2))).expect(400);
  });

  it.each([
    ['end before start', { start: '10:00', end: '09:00' }],
    ['end equal to start', { start: '10:00', end: '10:00' }],
    ['an invalid time', { start: '25:00' }],
    ['a time without leading zero', { start: '9:00' }],
    ['a blank category', { category: '   ' }],
    ['a supplied owner', { userId: '00000000-0000-4000-8000-000000000000' }],
    ['a supplied source', { source: 'MANUAL' }],
  ])('refuses %s', async (_name, extra) => {
    const member = await newMember();
    await member.post('/api/activity/entries', entry(today, extra)).expect(400);
  });

  it('allows overlapping entries, because the rules do not forbid them', async () => {
    const member = await newMember();
    await member.post('/api/activity/entries', entry(today)).expect(201);
    await member.post('/api/activity/entries', entry(today, { start: '09:30', end: '11:00' })).expect(201);
  });
});

describe('changing entries', () => {
  it('allows editing and deleting inside the window', async () => {
    const member = await newMember();
    const created = await member.post('/api/activity/entries', entry(yesterday)).expect(201);
    const url = `/api/activity/entries/${created.body.id}`;
    const edited = await member
      .put(url, { start: '08:00', end: '09:00', category: 'Meetings', note: '' })
      .expect(200);
    expect(edited.body).toMatchObject({ start: '08:00', minutes: 60, category: 'Meetings' });
    await member.delete(url).expect(204);
    expect(await db.activityEntry.findUnique({ where: { id: created.body.id } })).toBeNull();
  });

  it('locks entries after the following day', async () => {
    const member = await newMember();
    const open = await oldEntry(member.id, 1);
    const locked = await oldEntry(member.id, 2);
    const body = { start: '08:00', end: '09:00', category: 'X', note: '' };
    await member.put(`/api/activity/entries/${open.id}`, body).expect(200);
    const res = await member.put(`/api/activity/entries/${locked.id}`, body).expect(403);
    expect(res.body.error.code).toBe('ENTRY_LOCKED');
    await member.delete(`/api/activity/entries/${locked.id}`).expect(403);
  });

  it('is limited to the owner, even for the Admin and TeamLeaders', async () => {
    const member = await newMember();
    const created = await member.post('/api/activity/entries', entry(today)).expect(201);
    const url = `/api/activity/entries/${created.body.id}`;
    const body = { start: '08:00', end: '09:00', category: 'X', note: '' };
    for (const other of [admin, leader, noTeam]) {
      await other.put(url, body).expect(403);
      await other.delete(url).expect(403);
    }
  });

  it('stops at once when the user leaves their last team, and resumes on rejoining', async () => {
    const member = await newMember();
    const created = await member.post('/api/activity/entries', entry(today)).expect(201);
    await member.post(`/api/teams/${teamId}/leave`).expect(204);

    const url = `/api/activity/entries/${created.body.id}`;
    const body = { start: '08:00', end: '09:00', category: 'X', note: '' };
    await member.put(url, body).expect(403);
    await member.delete(url).expect(403);
    await member.post('/api/activity/entries', entry(today)).expect(403);
    const list = await member.get(`/api/activity/entries?userId=${member.id}`).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].canEdit).toBe(false);

    await addMember(member.id, teamId);
    await member.put(url, body).expect(200);
  });

  it('returns 404 for an unknown entry', async () => {
    const member = await newMember();
    const url = '/api/activity/entries/00000000-0000-4000-8000-000000000000';
    await member.delete(url).expect(404);
  });
});

describe('reading', () => {
  it('is open to every logged-in user', async () => {
    const member = await newMember();
    await member.post('/api/activity/entries', entry(today)).expect(201);
    for (const viewer of [admin, leader, noTeam]) {
      const list = await viewer.get(`/api/activity/entries?userId=${member.id}`).expect(200);
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0].canEdit).toBe(false);
      await viewer.get('/api/activity/dashboard').expect(200);
    }
  });

  it('keeps a deactivated user\'s entries visible', async () => {
    const member = await newMember();
    await member.post('/api/activity/entries', entry(today)).expect(201);
    await admin.post(`/api/users/${member.id}/deactivate`).expect(204);
    const list = await noTeam.get(`/api/activity/entries?userId=${member.id}`).expect(200);
    expect(list.body.items[0].user.deactivated).toBe(true);
  });

  it('needs a login', async () => {
    const { default: request } = await import('supertest');
    const { app } = await import('./helpers.ts');
    await request(app).get('/api/activity/dashboard').expect(401);
    await request(app).get('/api/activity/entries').expect(401);
  });
});

describe('dashboard', () => {
  let team: { id: string };
  let first: Client;

  beforeAll(async () => {
    team = await createTeam();
    first = await newMember(team.id, 'Alpha');
    const second = await newMember(team.id, 'Beta');
    await first.post('/api/activity/entries', entry(today, { start: '09:00', end: '11:00', category: 'Design' })).expect(201);
    await first.post('/api/activity/entries', entry(yesterday, { start: '09:00', end: '10:00', category: 'design' })).expect(201);
    await second.post('/api/activity/entries', entry(today, { start: '13:00', end: '13:30', category: 'Review' })).expect(201);
  });

  const load = async (query = '') =>
    (await noTeam.get(`/api/activity/dashboard?teamId=${team.id}${query}`).expect(200)).body;

  it('totals time, days, categories and people', async () => {
    const data = await load();
    expect(data.totalMinutes).toBe(210);
    expect(data.entryCount).toBe(3);
    expect(data.peopleCount).toBe(2);
    expect(data.byPerson).toMatchObject([
      { name: 'Alpha', minutes: 180, activeDays: 2 },
      { name: 'Beta', minutes: 30, activeDays: 1 },
    ]);
    expect(data.byDay.at(-1)).toEqual({ date: today, minutes: 150 });
    expect(data.byDay.at(-2)).toEqual({ date: yesterday, minutes: 60 });
  });

  it('groups categories regardless of case', async () => {
    const data = await load();
    expect(data.byCategory).toHaveLength(2);
    expect(data.byCategory[0].minutes).toBe(180);
    expect(data.byCategory[0].category.toLowerCase()).toBe('design');
  });

  it('defaults to 7 days, including days with no time', async () => {
    const data = await load();
    expect(data.byDay).toHaveLength(7);
    expect(data.from).toBe(addDays(today, -6));
    expect(data.byDay[0].minutes).toBe(0);
  });

  it('honours the date range', async () => {
    const data = await load(`&from=${today}&to=${today}`);
    expect(data.totalMinutes).toBe(150);
    expect(data.byDay).toHaveLength(1);
  });

  it('counts only the chosen team', async () => {
    const other = await createTeam();
    const data = await (await noTeam.get(`/api/activity/dashboard?teamId=${other.id}`).expect(200)).body;
    expect(data.totalMinutes).toBe(0);
    expect(data.byPerson).toEqual([]);
  });

  it('rejects a reversed or oversized range', async () => {
    await noTeam.get(`/api/activity/dashboard?from=${today}&to=${yesterday}`).expect(400);
    await noTeam.get(`/api/activity/dashboard?from=${addDays(today, -100)}&to=${today}`).expect(400);
    await noTeam.get(`/api/activity/dashboard?from=${addDays(today, -91)}&to=${today}`).expect(200);
  });
});
