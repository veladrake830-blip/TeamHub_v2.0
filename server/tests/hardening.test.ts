// Runs with rate limiting on, unlike the other test files.
import { describe, expect, it, vi } from 'vitest';

vi.stubEnv('RATE_LIMIT', 'on');
const { addMember, app, auditEntries, createTeam, createUser, loginAs, PASSWORD } = await import('./helpers.ts');
const { default: request } = await import('supertest');

const login = (email: string, password: string) => request(app).post('/api/auth/login').send({ email, password });

describe('login rate limits', () => {
  it('blocks repeated guessing against one account, but not a colleague on the same address', async () => {
    const target = await createUser();
    const colleague = await createUser();
    for (let i = 0; i < 10; i++) await login(target.email, 'wrong-password').expect(401);

    const blocked = await login(target.email, PASSWORD).expect(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    await login(colleague.email, PASSWORD).expect(200);
  });

  it('treats different spellings of one email as the same account', async () => {
    const target = await createUser();
    for (let i = 0; i < 10; i++) await login(target.email, 'wrong-password').expect(401);
    await login(target.email.toUpperCase(), PASSWORD).expect(429);
  });

  it('does not limit session refreshes, which everyone in an office makes constantly', async () => {
    const client = await loginAs(await createUser());
    for (let i = 0; i < 40; i++) await client.agent.post('/api/auth/refresh').expect(200);
  });
});

describe('current password checks', () => {
  it('stop after repeated guesses from one session, without limiting normal profile edits', async () => {
    const client = await loginAs(await createUser());
    const guess = () => client.put('/api/users/me/password', { currentPassword: 'wrong', newPassword: 'another-password' });
    for (let i = 0; i < 10; i++) await guess().expect(403);
    await guess().expect(429);
    for (let i = 0; i < 12; i++) await client.patch('/api/users/me', { slogan: `Edit ${i}` }).expect(204);
  });
});

describe('security headers', () => {
  const headers = async () => (await request(app).get('/api/auth/me')).headers;

  it('do not force HTTPS while the site runs on plain HTTP', async () => {
    const h = await headers();
    expect(h['content-security-policy']).not.toContain('upgrade-insecure-requests');
    expect(h['strict-transport-security']).toBeUndefined();
  });

  it('protect reset links and uploaded files', async () => {
    const h = await headers();
    expect(h['referrer-policy']).toBe('no-referrer');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-powered-by']).toBeUndefined();
  });
});

describe('secrets in responses', () => {
  it('never include password hashes', async () => {
    const team = await createTeam();
    const user = await createUser();
    await addMember(user.id, team.id);
    const client = await loginAs(user);
    for (const url of ['/api/auth/me', `/api/users/${user.id}`, '/api/users', `/api/teams/${team.id}`]) {
      const res = await client.get(url).expect(200);
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2b\$/);
    }
  });
});

describe('preferences', () => {
  it('saves a theme for the account and refuses anything else', async () => {
    const client = await loginAs(await createUser());
    expect((await client.get('/api/auth/me')).body.theme).toBe('SYSTEM');
    await client.put('/api/users/me/preferences', { theme: 'DARK' }).expect(204);
    expect((await client.get('/api/auth/me')).body.theme).toBe('DARK');
    await client.put('/api/users/me/preferences', { theme: 'PINK' }).expect(400);
    await client.put('/api/users/me/preferences', { theme: 'DARK', isAdmin: true }).expect(400);
  });
});

describe('team edits', () => {
  it('audit only the fields that really changed', async () => {
    const team = await createTeam();
    const leader = await createUser();
    await addMember(leader.id, team.id, 'TEAM_LEADER');
    const client = await loginAs(leader);
    await client.patch(`/api/teams/${team.id}`, { name: team.name, slogan: 'New' }).expect(204);
    await client.patch(`/api/teams/${team.id}`, { name: team.name, slogan: 'New' }).expect(204);
    const entries = await auditEntries('TEAM_UPDATED', team.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.details).toMatchObject({ fields: 'slogan' });
  });
});
