import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config.ts';
import {
  addMember,
  app,
  auditEntries,
  createTeam,
  createUser,
  db,
  getAdmin,
  loginAs,
  PASSWORD,
  tokenFrom,
  uniqueEmail,
  type Client,
} from './helpers.ts';

let admin: Client;
beforeAll(async () => {
  admin = await loginAs(await getAdmin());
});

/** Moves used tokens out of the few seconds' grace given to tabs refreshing together. */
const ageUsedTokens = (userId: string) =>
  db.usedRefreshToken.updateMany({
    where: { session: { userId } },
    data: { usedAt: new Date(Date.now() - (config.refreshReuseGraceSeconds + 1) * 1000) },
  });

const login = (email: string, password = PASSWORD) =>
  request(app).post('/api/auth/login').send({ email, password });

async function issueLink(userId: string) {
  const res = await admin.post(`/api/users/${userId}/reset-link`).expect(201);
  return tokenFrom(res.body.url);
}

describe('registration', () => {
  it('creates a pending account that cannot log in until the Admin activates it', async () => {
    const email = uniqueEmail();
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'New', email, password: PASSWORD })
      .expect(201);

    const blocked = await login(email).expect(403);
    expect(blocked.body.error.code).toBe('ACCOUNT_PENDING');

    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user.isAdmin).toBe(false);
    await admin.post(`/api/users/${user.id}/activate`).expect(204);
    await login(email).expect(200);
  });

  it.each([{ role: 'Admin' }, { isAdmin: true }, { status: 'ACTIVE' }])('rejects the extra field %o', async (extra) => {
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'New', email: uniqueEmail(), password: PASSWORD, ...extra })
      .expect(400);
  });

  it('gives a taken email the same answer as a new one, and creates no account', async () => {
    const email = uniqueEmail();
    const register = (address: string) =>
      request(app).post('/api/auth/register').send({ name: 'N', email: address, password: PASSWORD });
    const first = await register(email).expect(201);
    const second = await register(email.toUpperCase()).expect(201);
    expect(second.body).toEqual(first.body);
    expect(await db.user.count({ where: { email: { equals: email, mode: 'insensitive' } } })).toBe(1);
  });

  it('rejects a password bcrypt would silently truncate', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'N', email: uniqueEmail(), password: 'x'.repeat(73) })
      .expect(400);
  });
});

describe('login', () => {
  it('uses one message for a wrong password and an unknown email', async () => {
    const user = await createUser();
    const wrong = await login(user.email, 'wrong-password').expect(401);
    const unknown = await login(uniqueEmail()).expect(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('does not reveal account status without the right password', async () => {
    const user = await createUser({ status: 'DEACTIVATED' });
    await login(user.email, 'wrong-password').expect(401);
    const res = await login(user.email).expect(403);
    expect(res.body.error.code).toBe('ACCOUNT_DEACTIVATED');
  });

  it('records success and failure in the audit log', async () => {
    const user = await createUser();
    await login(user.email).expect(200);
    expect(await auditEntries('LOGIN', user.id)).toHaveLength(1);
    await login(user.email, 'wrong-password').expect(401);
    const failed = await db.auditLog.findMany({ where: { action: 'LOGIN_FAILED' } });
    expect(failed.some((e) => (e.details as { email?: string })?.email === user.email)).toBe(true);
  });
});

describe('access takes effect immediately', () => {
  it('deactivation stops a valid access token and the refresh token', async () => {
    const user = await createUser();
    const client = await loginAs(user);
    await client.get('/api/auth/me').expect(200);
    await admin.post(`/api/users/${user.id}/deactivate`).expect(204);
    await client.get('/api/auth/me').expect(401);
    await client.agent.post('/api/auth/refresh').expect(401);
  });

  it('a role change applies to an access token already issued', async () => {
    const team = await createTeam();
    const leader = await createUser();
    const coLeader = await createUser();
    await addMember(leader.id, team.id, 'TEAM_LEADER');
    await addMember(coLeader.id, team.id, 'TEAM_LEADER');
    const client = await loginAs(leader);
    await client.patch(`/api/teams/${team.id}`, { slogan: 'one' }).expect(204);
    await admin.patch(`/api/teams/${team.id}/members/${leader.id}`, { role: 'MEMBER' }).expect(204);
    await client.patch(`/api/teams/${team.id}`, { slogan: 'two' }).expect(403);
  });

  it('removal from a team applies to an access token already issued', async () => {
    const team = await createTeam();
    const leader = await createUser();
    const coLeader = await createUser();
    await addMember(leader.id, team.id, 'TEAM_LEADER');
    await addMember(coLeader.id, team.id, 'TEAM_LEADER');
    const client = await loginAs(leader);
    await admin.delete(`/api/teams/${team.id}/members/${leader.id}`).expect(204);
    await client.patch(`/api/teams/${team.id}`, { slogan: 'x' }).expect(403);
  });
});

describe('refresh tokens', () => {
  it('rotates, and keeps the cookie httpOnly and SameSite=Strict', async () => {
    const user = await createUser();
    const client = await loginAs(user);
    const res = await client.agent.post('/api/auth/refresh').expect(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(res.body.accessToken).toBeTruthy();
  });

  it('stores only a hash of the token', async () => {
    const user = await createUser();
    const res = await login(user.email).expect(200);
    const raw = /teamhub_refresh=([^;]+)/.exec(String(res.headers['set-cookie']))?.[1];
    const session = await db.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(raw).toBeTruthy();
    expect(session.refreshTokenHash).not.toBe(raw);
  });

  it('ends the session when an old token is replayed after the grace period', async () => {
    const user = await createUser();
    const first = await login(user.email).expect(200);
    const oldCookie = String(first.headers['set-cookie']).split(';')[0] ?? '';
    const refresh = (cookie: string) => request(app).post('/api/auth/refresh').set('Cookie', cookie);

    const second = await refresh(oldCookie).expect(200);
    const newCookie = String(second.headers['set-cookie']).split(';')[0] ?? '';
    await ageUsedTokens(user.id);

    await refresh(oldCookie).expect(401);
    await refresh(newCookie).expect(401);
  });

  it('detects any old token, not only the most recent one', async () => {
    const user = await createUser();
    const stolen = await login(user.email).expect(200);
    const refresh = (cookie: string) => request(app).post('/api/auth/refresh').set('Cookie', cookie);
    const cookieOf = (res: { headers: Record<string, unknown> }) => String(res.headers['set-cookie']).split(';')[0] ?? '';

    const first = cookieOf(stolen);
    const second = await refresh(first).expect(200);
    const third = await refresh(cookieOf(second)).expect(200);
    await ageUsedTokens(user.id);

    await refresh(first).expect(401);
    await refresh(cookieOf(third)).expect(401);
  });

  it('ends a session at its maximum age, however often it is used', async () => {
    const user = await createUser();
    const client = await loginAs(user);
    const old = new Date(Date.now() - (config.sessionMaxDays + 1) * 86_400_000);
    await db.session.updateMany({ where: { userId: user.id }, data: { createdAt: old } });
    const res = await client.agent.post('/api/auth/refresh').expect(200);
    expect(res.body.accessToken).toBeTruthy();
    const session = await db.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(session.expiresAt.getTime()).toBeLessThan(Date.now());
    await client.agent.post('/api/auth/refresh').expect(401);
  });

  it('logout ends the session', async () => {
    const user = await createUser();
    const client = await loginAs(user);
    await client.agent.post('/api/auth/logout').expect(204);
    await client.get('/api/auth/me').expect(401);
  });
});

describe('password reset links', () => {
  const complete = (token: string, password = 'a-brand-new-password') =>
    request(app).post('/api/auth/password-reset/complete').send({ token, password });

  it('sets the new password, ends sessions, audits both steps and shows a notice', async () => {
    const user = await createUser();
    const session = await loginAs(user);
    const token = await issueLink(user.id);

    await complete(token).expect(204);

    await session.get('/api/auth/me').expect(401);
    await login(user.email).expect(401);
    const fresh = await login(user.email, 'a-brand-new-password').expect(200);
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${fresh.body.accessToken}`)
      .expect(200);
    expect(me.body.passwordResetNoticeAt).toBeTruthy();
    expect(await auditEntries('PASSWORD_RESET_LINK_ISSUED', user.id)).toHaveLength(1);
    expect(await auditEntries('PASSWORD_RESET_LINK_USED', user.id)).toHaveLength(1);
  });

  it('works only once, even for two requests at the same moment', async () => {
    const user = await createUser();
    const token = await issueLink(user.id);
    const results = await Promise.all([complete(token), complete(token)]);
    expect(results.map((r) => r.status).sort()).toEqual([204, 400]);
    await complete(token).expect(400);
  });

  it('expires after 24 hours', async () => {
    const user = await createUser();
    const token = await issueLink(user.id);
    await db.passwordResetToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await complete(token).expect(400);
  });

  it('issues links lasting 24 hours and stores only a hash', async () => {
    const user = await createUser();
    const res = await admin.post(`/api/users/${user.id}/reset-link`).expect(201);
    const hours = (new Date(res.body.expiresAt).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThanOrEqual(24);
    const stored = await db.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored.tokenHash).not.toBe(tokenFrom(res.body.url));
  });

  it('replaces an earlier unused link', async () => {
    const user = await createUser();
    const first = await issueLink(user.id);
    await issueLink(user.id);
    await complete(first).expect(400);
  });

  it('stops working when the user is deactivated', async () => {
    const user = await createUser();
    const token = await issueLink(user.id);
    await admin.post(`/api/users/${user.id}/deactivate`).expect(204);
    await complete(token).expect(400);
  });

  describe('issued by a TeamLeader', () => {
    async function setup() {
      const team = await createTeam();
      const leaderUser = await createUser();
      const coLeaderUser = await createUser();
      const member = await createUser();
      await addMember(leaderUser.id, team.id, 'TEAM_LEADER');
      await addMember(coLeaderUser.id, team.id, 'TEAM_LEADER');
      await addMember(member.id, team.id);
      return { team, member, coLeaderUser, leader: await loginAs(leaderUser), leaderUser };
    }
    const issue = async (client: Client, userId: string) =>
      tokenFrom((await client.post(`/api/users/${userId}/reset-link`).expect(201)).body.url);

    it('cannot be issued by demoting a co-leader first', async () => {
      const { team, leader, coLeaderUser } = await setup();
      await leader.patch(`/api/teams/${team.id}/members/${coLeaderUser.id}`, { role: 'MEMBER' }).expect(204);
      await leader.post(`/api/users/${coLeaderUser.id}/reset-link`).expect(403);
      await admin.post(`/api/users/${coLeaderUser.id}/reset-link`).expect(201);
    });

    it('can be issued again once the protection period ends', async () => {
      const { team, leader, coLeaderUser } = await setup();
      await leader.patch(`/api/teams/${team.id}/members/${coLeaderUser.id}`, { role: 'MEMBER' }).expect(204);
      await db.user.update({ where: { id: coLeaderUser.id }, data: { resetLockedUntil: new Date(Date.now() - 1000) } });
      await leader.post(`/api/users/${coLeaderUser.id}/reset-link`).expect(201);
    });

    it('stops working if the user becomes a TeamLeader', async () => {
      const { team, leader, member } = await setup();
      const token = await issue(leader, member.id);
      await leader.patch(`/api/teams/${team.id}/members/${member.id}`, { role: 'TEAM_LEADER' }).expect(204);
      await complete(token).expect(400);
    });

    it('stops working if the user leads a different team', async () => {
      const { leader, member } = await setup();
      const token = await issue(leader, member.id);
      const other = await createTeam();
      await addMember(member.id, other.id, 'TEAM_LEADER');
      await complete(token).expect(400);
    });

    it('stops working if the issuer is no longer their leader', async () => {
      const { team, leader, leaderUser, member } = await setup();
      const token = await issue(leader, member.id);
      await admin.patch(`/api/teams/${team.id}/members/${leaderUser.id}`, { role: 'MEMBER' }).expect(204);
      await complete(token).expect(400);
    });

    it('stops working if the user leaves the team', async () => {
      const { team, leader, member } = await setup();
      const token = await issue(leader, member.id);
      await (await loginAs(member)).post(`/api/teams/${team.id}/leave`).expect(204);
      await complete(token).expect(400);
    });

    it('stops working if the issuer is deactivated', async () => {
      const { leader, leaderUser, member } = await setup();
      const token = await issue(leader, member.id);
      await admin.post(`/api/users/${leaderUser.id}/deactivate`).expect(204);
      await complete(token).expect(400);
    });

    it('stops working if the user changes their own password', async () => {
      const { leader, member } = await setup();
      const token = await issue(leader, member.id);
      const client = await loginAs(member);
      await client.put('/api/users/me/password', { currentPassword: PASSWORD, newPassword: 'chosen-by-member' }).expect(204);
      await complete(token).expect(400);
    });

    it('still works in the normal case', async () => {
      const { leader, member } = await setup();
      await complete(await issue(leader, member.id)).expect(204);
    });
  });

  it('puts the token in the URL fragment, which servers and logs never see', async () => {
    const user = await createUser();
    const res = await admin.post(`/api/users/${user.id}/reset-link`).expect(201);
    expect(new URL(res.body.url).pathname).toBe('/reset-password');
    expect(new URL(res.body.url).hash.length).toBeGreaterThan(20);
  });

  it('cannot be issued for the Admin, even by the Admin', async () => {
    await admin.post(`/api/users/${admin.id}/reset-link`).expect(403);
  });

  it('gives an Admin-added user a first password with no reset notice', async () => {
    const email = uniqueEmail();
    const created = await admin.post('/api/users', { name: 'Added', email }).expect(201);
    await login(email).expect(401);
    await complete(tokenFrom(created.body.firstPasswordLink.url)).expect(204);
    const res = await login(email, 'a-brand-new-password').expect(200);
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .expect(200);
    expect(me.body.passwordResetNoticeAt).toBeNull();
  });
});

describe('own account', () => {
  it('needs the current password to change email', async () => {
    const user = await createUser();
    const client = await loginAs(user);
    const email = uniqueEmail();
    await client.patch('/api/users/me', { email }).expect(403);
    await client.patch('/api/users/me', { email, currentPassword: PASSWORD }).expect(204);
    await login(email).expect(200);
  });

  it('keeps this session and ends others on a password change', async () => {
    const user = await createUser();
    const here = await loginAs(user);
    const elsewhere = await loginAs(user);
    await here.put('/api/users/me/password', { currentPassword: PASSWORD, newPassword: 'another-password' }).expect(204);
    await here.get('/api/auth/me').expect(200);
    await elsewhere.get('/api/auth/me').expect(401);
  });
});

describe('the Admin account', () => {
  it('cannot be deactivated', async () => {
    await admin.post(`/api/users/${admin.id}/deactivate`).expect(403);
  });

  it('is unique at the database level', async () => {
    await expect(
      db.user.create({ data: { name: 'Second', email: uniqueEmail(), isAdmin: true, status: 'ACTIVE' } }),
    ).rejects.toThrow();
  });
});

describe('directory privacy', () => {
  it('hides email and inactive accounts from everyone but the Admin', async () => {
    const pending = await createUser({ status: 'PENDING', name: 'Hidden Pending' });
    const user = await createUser();
    const client = await loginAs(user);
    const list = await client.get('/api/users?pageSize=100&q=Hidden').expect(200);
    expect(list.body.items).toHaveLength(0);
    const profile = await client.get(`/api/users/${admin.id}`).expect(200);
    expect(profile.body.email).toBeUndefined();
    await client.get(`/api/users/${pending.id}`).expect(404);
    const adminView = await admin.get(`/api/users/${user.id}`).expect(200);
    expect(adminView.body.email).toBe(user.email);
  });
});

describe('avatars', () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

  it('accepts a real image and serves it', async () => {
    const client = await loginAs(await createUser());
    const res = await client.agent
      .put('/api/users/me/avatar')
      .set('Authorization', `Bearer ${client.token}`)
      .attach('avatar', png, 'me.png')
      .expect(200);
    await request(app).get(res.body.avatarUrl).expect(200);
  });

  it('rejects content that is not an image, whatever its name says', async () => {
    const client = await loginAs(await createUser());
    await client.agent
      .put('/api/users/me/avatar')
      .set('Authorization', `Bearer ${client.token}`)
      .attach('avatar', Buffer.from('<script>alert(1)</script>'), { filename: 'me.png', contentType: 'image/png' })
      .expect(400);
  });
});
