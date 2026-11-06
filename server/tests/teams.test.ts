import { beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  auditEntries,
  createTeam,
  createUser,
  db,
  getAdmin,
  loginAs,
  type Client,
} from './helpers.ts';

let admin: Client;
beforeAll(async () => {
  admin = await loginAs(await getAdmin());
});

async function teamWithLeader() {
  const team = await createTeam();
  const leaderUser = await createUser();
  await addMember(leaderUser.id, team.id, 'TEAM_LEADER');
  return { team, leaderUser, leader: await loginAs(leaderUser) };
}

const membership = (userId: string, teamId: string) =>
  db.membership.findUnique({ where: { userId_teamId: { userId, teamId } } });

describe('creating teams', () => {
  it('appoints the first TeamLeader in one step', async () => {
    const leader = await createUser();
    const res = await admin.post('/api/teams', { name: `New ${leader.id}`, leaderId: leader.id }).expect(201);
    expect((await membership(leader.id, res.body.id))?.role).toBe('TEAM_LEADER');
    expect(await auditEntries('TEAM_CREATED', res.body.id)).toHaveLength(1);
  });

  it('refuses the Admin, pending or deactivated users as leader, and creates nothing', async () => {
    const pending = await createUser({ status: 'PENDING' });
    const gone = await createUser({ status: 'DEACTIVATED' });
    for (const leaderId of [admin.id, pending.id, gone.id]) {
      await admin.post('/api/teams', { name: `Bad ${leaderId}`, leaderId }).expect(400);
      expect(await db.team.findFirst({ where: { name: `Bad ${leaderId}` } })).toBeNull();
    }
  });
});

describe('the Admin is never a member', () => {
  it('is refused by the API and by the database', async () => {
    const { team, leader } = await teamWithLeader();
    await leader.post(`/api/teams/${team.id}/invitations`, { userId: admin.id }).expect(400);
    await admin.post(`/api/teams/${team.id}/join-requests`).expect(400);
    await admin.post(`/api/teams/${team.id}/leaders`, { userId: admin.id }).expect(400);
    await expect(addMember(admin.id, team.id)).rejects.toThrow();
  });
});

describe('invitations', () => {
  it('adds the user as a Member when accepted', async () => {
    const { team, leader } = await teamWithLeader();
    const user = await createUser();
    const client = await loginAs(user);
    await leader.post(`/api/teams/${team.id}/invitations`, { userId: user.id }).expect(201);

    const inbox = await client.get('/api/invitations').expect(200);
    expect(inbox.body).toHaveLength(1);
    await client.post(`/api/invitations/${inbox.body[0].id}/accept`).expect(204);

    expect((await membership(user.id, team.id))?.role).toBe('MEMBER');
    expect((await client.get('/api/invitations')).body).toHaveLength(0);
  });

  it('leaves the user out when declined', async () => {
    const { team, leader } = await teamWithLeader();
    const user = await createUser();
    const client = await loginAs(user);
    const created = await leader.post(`/api/teams/${team.id}/invitations`, { userId: user.id }).expect(201);
    await client.post(`/api/invitations/${created.body.id}/decline`).expect(204);
    expect(await membership(user.id, team.id)).toBeNull();
  });

  it('can only be answered by the invited user', async () => {
    const { team, leader } = await teamWithLeader();
    const invited = await createUser();
    const stranger = await loginAs(await createUser());
    const created = await leader.post(`/api/teams/${team.id}/invitations`, { userId: invited.id }).expect(201);
    await stranger.post(`/api/invitations/${created.body.id}/accept`).expect(404);
    expect(await membership(stranger.id, team.id)).toBeNull();
  });

  it('cannot be answered after a leader cancels it', async () => {
    const { team, leader } = await teamWithLeader();
    const user = await createUser();
    const client = await loginAs(user);
    const created = await leader.post(`/api/teams/${team.id}/invitations`, { userId: user.id }).expect(201);
    await leader.delete(`/api/teams/${team.id}/invitations/${created.body.id}`).expect(204);
    await client.post(`/api/invitations/${created.body.id}/accept`).expect(404);
  });

  it('joins nobody twice when accept and cancel happen at the same moment', async () => {
    const { team, leader } = await teamWithLeader();
    const user = await createUser();
    const client = await loginAs(user);
    const created = await leader.post(`/api/teams/${team.id}/invitations`, { userId: user.id }).expect(201);
    const results = await Promise.all([
      client.post(`/api/invitations/${created.body.id}/accept`),
      leader.delete(`/api/teams/${team.id}/invitations/${created.body.id}`),
    ]);
    const invitation = await db.invitation.findUniqueOrThrow({ where: { id: created.body.id } });
    const joined = (await membership(user.id, team.id)) !== null;
    expect(results.filter((r) => r.status === 204)).toHaveLength(1);
    expect(joined).toBe(invitation.status === 'ACCEPTED');
  });

  it('refuses pending and deactivated accounts, duplicates and existing members', async () => {
    const { team, leader, leaderUser } = await teamWithLeader();
    const invite = (userId: string) => leader.post(`/api/teams/${team.id}/invitations`, { userId });
    await invite((await createUser({ status: 'PENDING' })).id).expect(400);
    await invite((await createUser({ status: 'DEACTIVATED' })).id).expect(400);
    const user = await createUser();
    await invite(user.id).expect(201);
    await invite(user.id).expect(409);
    await invite(leaderUser.id).expect(409);
  });
});

describe('join requests', () => {
  it('adds the user as a Member when approved, and closes a pending invitation', async () => {
    const { team, leader } = await teamWithLeader();
    const user = await createUser();
    const client = await loginAs(user);
    await leader.post(`/api/teams/${team.id}/invitations`, { userId: user.id }).expect(201);
    const request = await client.post(`/api/teams/${team.id}/join-requests`).expect(201);
    await leader.post(`/api/teams/${team.id}/join-requests/${request.body.id}/approve`).expect(204);
    expect((await membership(user.id, team.id))?.role).toBe('MEMBER');
    expect((await client.get('/api/invitations')).body).toHaveLength(0);
  });

  it('adds nobody when rejected, and rejects a second decision', async () => {
    const { team, leader } = await teamWithLeader();
    const user = await createUser();
    const client = await loginAs(user);
    const request = await client.post(`/api/teams/${team.id}/join-requests`).expect(201);
    const url = `/api/teams/${team.id}/join-requests/${request.body.id}`;
    await leader.post(`${url}/reject`).expect(204);
    await leader.post(`${url}/approve`).expect(404);
    expect(await membership(user.id, team.id)).toBeNull();
  });

  it('refuses a duplicate or an existing member, and can be cancelled by the requester', async () => {
    const { team, leader } = await teamWithLeader();
    const client = await loginAs(await createUser());
    const request = await client.post(`/api/teams/${team.id}/join-requests`).expect(201);
    await client.post(`/api/teams/${team.id}/join-requests`).expect(409);
    await leader.post(`/api/teams/${team.id}/join-requests`).expect(409);
    await client.delete(`/api/teams/${team.id}/join-requests/${request.body.id}`).expect(204);
  });

  it('does not expose pending requests to non-leaders', async () => {
    const { team } = await teamWithLeader();
    const member = await createUser();
    await addMember(member.id, team.id);
    const requester = await loginAs(await createUser());
    await requester.post(`/api/teams/${team.id}/join-requests`).expect(201);
    const view = await (await loginAs(member)).get(`/api/teams/${team.id}`).expect(200);
    expect(view.body.joinRequests).toEqual([]);
    expect(view.body.canManage).toBe(false);
  });
});

describe('the last active TeamLeader', () => {
  it('cannot leave until another is appointed', async () => {
    const { team, leader, leaderUser } = await teamWithLeader();
    const res = await leader.post(`/api/teams/${team.id}/leave`).expect(409);
    expect(res.body.error.code).toBe('LAST_LEADER');
    const member = await createUser();
    await addMember(member.id, team.id);
    await leader.patch(`/api/teams/${team.id}/members/${member.id}`, { role: 'TEAM_LEADER' }).expect(204);
    await leader.post(`/api/teams/${team.id}/leave`).expect(204);
    expect(await membership(leaderUser.id, team.id)).toBeNull();
  });

  it('cannot demote or remove themselves, but the Admin can do both', async () => {
    const { team, leader, leaderUser } = await teamWithLeader();
    await leader.patch(`/api/teams/${team.id}/members/${leaderUser.id}`, { role: 'MEMBER' }).expect(409);
    await leader.delete(`/api/teams/${team.id}/members/${leaderUser.id}`).expect(409);
    await admin.patch(`/api/teams/${team.id}/members/${leaderUser.id}`, { role: 'MEMBER' }).expect(204);
    await admin.delete(`/api/teams/${team.id}/members/${leaderUser.id}`).expect(204);
  });

  it('does not count a deactivated co-leader', async () => {
    const { team, leader } = await teamWithLeader();
    const coLeader = await createUser();
    await addMember(coLeader.id, team.id, 'TEAM_LEADER');
    await admin.post(`/api/users/${coLeader.id}/deactivate`).expect(204);
    await leader.post(`/api/teams/${team.id}/leave`).expect(409);
  });

  it('survives two co-leaders leaving at the same moment', async () => {
    const { team, leader } = await teamWithLeader();
    const coLeader = await createUser();
    await addMember(coLeader.id, team.id, 'TEAM_LEADER');
    const co = await loginAs(coLeader);
    const results = await Promise.all([
      leader.post(`/api/teams/${team.id}/leave`),
      co.post(`/api/teams/${team.id}/leave`),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([204, 409]);
    expect(await db.membership.count({ where: { teamId: team.id, role: 'TEAM_LEADER' } })).toBe(1);
  });
});

describe('deactivated members', () => {
  it('keep their membership, and the Admin can appoint a new leader', async () => {
    const { team, leaderUser } = await teamWithLeader();
    await admin.post(`/api/users/${leaderUser.id}/deactivate`).expect(204);
    expect(await membership(leaderUser.id, team.id)).not.toBeNull();

    const view = await admin.get(`/api/teams/${team.id}`).expect(200);
    expect(view.body.hasActiveLeader).toBe(false);

    const next = await createUser();
    await admin.post(`/api/teams/${team.id}/leaders`, { userId: next.id }).expect(204);
    expect((await membership(next.id, team.id))?.role).toBe('TEAM_LEADER');

    await admin.post(`/api/users/${leaderUser.id}/activate`).expect(204);
    expect((await membership(leaderUser.id, team.id))?.role).toBe('TEAM_LEADER');
  });

  it('cannot be promoted', async () => {
    const { team, leader } = await teamWithLeader();
    const user = await createUser();
    await addMember(user.id, team.id);
    await admin.post(`/api/users/${user.id}/deactivate`).expect(204);
    await leader.patch(`/api/teams/${team.id}/members/${user.id}`, { role: 'TEAM_LEADER' }).expect(400);
  });

  it('have their open invitations and requests closed', async () => {
    const { team, leader } = await teamWithLeader();
    const user = await createUser();
    const created = await leader.post(`/api/teams/${team.id}/invitations`, { userId: user.id }).expect(201);
    await admin.post(`/api/users/${user.id}/deactivate`).expect(204);
    const invitation = await db.invitation.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(invitation.status).toBe('CANCELLED');
  });
});

describe('membership across teams', () => {
  it('lets one user hold different roles in different teams', async () => {
    const a = await teamWithLeader();
    const b = await createTeam();
    await addMember(a.leaderUser.id, b.id, 'MEMBER');
    await a.leader.patch(`/api/teams/${a.team.id}`, { slogan: 'mine' }).expect(204);
    await a.leader.patch(`/api/teams/${b.id}`, { slogan: 'theirs' }).expect(403);
  });

  it('removing a user does not affect their account or other teams', async () => {
    const { team, leader } = await teamWithLeader();
    const other = await createTeam();
    const user = await createUser();
    await addMember(user.id, team.id);
    await addMember(user.id, other.id);
    await leader.delete(`/api/teams/${team.id}/members/${user.id}`).expect(204);
    expect(await membership(user.id, other.id)).not.toBeNull();
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe('ACTIVE');
    await (await loginAs(user)).get('/api/auth/me').expect(200);
  });

  it('lets any member leave', async () => {
    const { team } = await teamWithLeader();
    const user = await createUser();
    await addMember(user.id, team.id);
    await (await loginAs(user)).post(`/api/teams/${team.id}/leave`).expect(204);
    expect(await auditEntries('MEMBER_LEFT', team.id)).toHaveLength(1);
  });
});

describe('follows', () => {
  it('shows followed users and teams on the profile', async () => {
    const { team } = await teamWithLeader();
    const user = await createUser();
    const followee = await createUser({ name: 'Followed' });
    const client = await loginAs(user);
    await client.put(`/api/users/${followee.id}/follow`).expect(204);
    await client.put(`/api/users/${followee.id}/follow`).expect(204);
    await client.put(`/api/teams/${team.id}/follow`).expect(204);
    await client.put(`/api/users/${user.id}/follow`).expect(400);

    const profile = await client.get(`/api/users/${user.id}`).expect(200);
    expect(profile.body.followingUsers).toHaveLength(1);
    expect(profile.body.followingTeams).toHaveLength(1);

    await client.delete(`/api/users/${followee.id}/follow`).expect(204);
    const after = await client.get(`/api/users/${user.id}`).expect(200);
    expect(after.body.followingUsers).toHaveLength(0);
  });
});
