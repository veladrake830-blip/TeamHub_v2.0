import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.ts';
import { db } from '../src/db.ts';
import { hashPassword } from '../src/lib/passwords.ts';

export const app = createApp();
export const PASSWORD = 'correct-horse-battery';
const passwordHash = await hashPassword(PASSWORD);

export { db };

export const uniqueEmail = () => `user-${randomUUID()}@test.local`;

interface UserOptions {
  status?: 'PENDING' | 'ACTIVE' | 'DEACTIVATED';
  name?: string;
}

export function createUser(options: UserOptions = {}) {
  return db.user.create({
    data: {
      name: options.name ?? 'Test User',
      email: uniqueEmail(),
      passwordHash,
      status: options.status ?? 'ACTIVE',
    },
  });
}

export async function getAdmin() {
  return db.user.upsert({
    where: { email: 'admin@test.local' },
    create: { name: 'Admin', email: 'admin@test.local', passwordHash, isAdmin: true, status: 'ACTIVE' },
    update: {},
  });
}

export function createTeam(name = `Team ${randomUUID()}`) {
  return db.team.create({ data: { name } });
}

export function addMember(userId: string, teamId: string, role: 'TEAM_LEADER' | 'MEMBER' = 'MEMBER') {
  return db.membership.create({ data: { userId, teamId, role } });
}

export interface Client {
  id: string;
  token: string;
  agent: ReturnType<typeof request.agent>;
  get(url: string): request.Test;
  post(url: string, body?: object): request.Test;
  patch(url: string, body?: object): request.Test;
  put(url: string, body?: object): request.Test;
  delete(url: string): request.Test;
}

/** Logs in through the real endpoint and returns a client that sends the access token. */
export async function loginAs(user: { id: string; email: string }): Promise<Client> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD }).expect(200);
  const token: string = res.body.accessToken;
  const auth = { Authorization: `Bearer ${token}` };
  return {
    id: user.id,
    token,
    agent,
    get: (url) => agent.get(url).set(auth),
    post: (url, body) => agent.post(url).set(auth).send(body),
    patch: (url, body) => agent.patch(url).set(auth).send(body),
    put: (url, body) => agent.put(url).set(auth).send(body),
    delete: (url) => agent.delete(url).set(auth),
  };
}

export const auditEntries = (action: string, targetId?: string) =>
  db.auditLog.findMany({ where: { action, ...(targetId ? { targetId } : {}) } });

/** Pulls the raw token out of a reset link URL. */
export const tokenFrom = (url: string) => url.split('/reset-password#')[1] ?? '';
