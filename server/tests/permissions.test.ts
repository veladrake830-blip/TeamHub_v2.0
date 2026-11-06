// Runs the permission table from Readme section 2 through the real API, for every role.
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, createTeam, createUser, db, getAdmin, loginAs, uniqueEmail, type Client } from './helpers.ts';

type RoleName = 'admin' | 'leader' | 'member' | 'otherLeader' | 'noTeam';
const ROLES: RoleName[] = ['admin', 'leader', 'member', 'otherLeader', 'noTeam'];

let clients: Record<RoleName, Client>;
let teamId: string;

beforeAll(async () => {
  const team = await createTeam();
  const otherTeam = await createTeam();
  teamId = team.id;
  const admin = await getAdmin();
  const leader = await createUser();
  const member = await createUser();
  const otherLeader = await createUser();
  const noTeam = await createUser();
  await addMember(leader.id, team.id, 'TEAM_LEADER');
  await addMember(member.id, team.id, 'MEMBER');
  await addMember(otherLeader.id, otherTeam.id, 'TEAM_LEADER');
  clients = {
    admin: await loginAs(admin),
    leader: await loginAs(leader),
    member: await loginAs(member),
    otherLeader: await loginAs(otherLeader),
    noTeam: await loginAs(noTeam),
  };
});

/** Each case builds fresh targets, so an allowed call can't change the outcome of the next one. */
interface Case {
  action: string;
  allowed: RoleName[];
  run(client: Client): Promise<{ status: number }>;
}

const newMemberOfTeam = async () => {
  const user = await createUser();
  await addMember(user.id, teamId);
  return user;
};

const cases: Case[] = [
  {
    action: 'create a team',
    allowed: ['admin'],
    run: async (c) => {
      const leader = await createUser();
      return c.post('/api/teams', { name: `T-${leader.id}`, leaderId: leader.id });
    },
  },
  {
    action: 'edit TeamInfo',
    allowed: ['admin', 'leader'],
    run: (c) => c.patch(`/api/teams/${teamId}`, { slogan: 'New slogan' }),
  },
  {
    action: 'invite a user',
    allowed: ['admin', 'leader'],
    run: async (c) => {
      const user = await createUser();
      return c.post(`/api/teams/${teamId}/invitations`, { userId: user.id });
    },
  },
  {
    action: 'approve a join request',
    allowed: ['admin', 'leader'],
    run: async (c) => {
      const user = await createUser();
      const request = await db.joinRequest.create({ data: { teamId, userId: user.id } });
      return c.post(`/api/teams/${teamId}/join-requests/${request.id}/approve`);
    },
  },
  {
    action: 'remove a member',
    allowed: ['admin', 'leader'],
    run: async (c) => {
      const user = await newMemberOfTeam();
      return c.delete(`/api/teams/${teamId}/members/${user.id}`);
    },
  },
  {
    action: 'change a team role',
    allowed: ['admin', 'leader'],
    run: async (c) => {
      const user = await newMemberOfTeam();
      return c.patch(`/api/teams/${teamId}/members/${user.id}`, { role: 'TEAM_LEADER' });
    },
  },
  {
    action: 'appoint a leader directly',
    allowed: ['admin'],
    run: async (c) => {
      const user = await createUser();
      return c.post(`/api/teams/${teamId}/leaders`, { userId: user.id });
    },
  },
  {
    action: 'issue a reset link for a team Member',
    allowed: ['admin', 'leader'],
    run: async (c) => {
      const user = await newMemberOfTeam();
      return c.post(`/api/users/${user.id}/reset-link`);
    },
  },
  {
    action: 'issue a reset link for a user with no team',
    allowed: ['admin'],
    run: async (c) => {
      const user = await createUser();
      return c.post(`/api/users/${user.id}/reset-link`);
    },
  },
  {
    action: 'issue a reset link for a TeamLeader',
    allowed: ['admin'],
    run: async (c) => {
      const user = await createUser();
      await addMember(user.id, teamId, 'TEAM_LEADER');
      return c.post(`/api/users/${user.id}/reset-link`);
    },
  },
  {
    action: 'add an account',
    allowed: ['admin'],
    run: (c) => c.post('/api/users', { name: 'New', email: uniqueEmail() }),
  },
  {
    action: 'activate an account',
    allowed: ['admin'],
    run: async (c) => {
      const user = await createUser({ status: 'PENDING' });
      return c.post(`/api/users/${user.id}/activate`);
    },
  },
  {
    action: 'deactivate an account',
    allowed: ['admin'],
    run: async (c) => {
      const user = await createUser();
      return c.post(`/api/users/${user.id}/deactivate`);
    },
  },
  {
    action: 'edit another account',
    allowed: ['admin'],
    run: async (c) => {
      const user = await createUser();
      return c.patch(`/api/users/${user.id}`, { name: 'Renamed' });
    },
  },
];

describe.each(cases)('$action', ({ allowed, run }) => {
  it.each(ROLES)('%s', async (role) => {
    const res = await run(clients[role]);
    if (allowed.includes(role)) expect(res.status).toBeLessThan(300);
    else expect(res.status).toBe(403);
  });
});

describe('open to every logged-in user', () => {
  it.each(ROLES)('%s can edit their own profile and browse directories', async (role) => {
    const client = clients[role];
    await client.patch('/api/users/me', { slogan: `Hello from ${role}` }).expect(204);
    await client.get('/api/users').expect(200);
    await client.get('/api/teams').expect(200);
  });
});

describe('without logging in', () => {
  it('rejects every protected area', async () => {
    const { default: request } = await import('supertest');
    const { app } = await import('./helpers.ts');
    for (const url of ['/api/users', '/api/teams', '/api/invitations', '/api/auth/me']) {
      await request(app).get(url).expect(401);
    }
  });
});
