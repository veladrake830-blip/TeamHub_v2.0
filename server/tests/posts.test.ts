import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, auditEntries, createTeam, createUser, db, getAdmin, loginAs, type Client } from './helpers.ts';

type Name = 'admin' | 'author' | 'authorLeader' | 'secondTeamLeader' | 'teammate' | 'otherLeader' | 'noTeam';
let clients: Record<Name, Client>;
let teamId: string;

beforeAll(async () => {
  const team = await createTeam();
  const secondTeam = await createTeam();
  const otherTeam = await createTeam();
  teamId = team.id;
  const users = {
    author: await createUser({ name: 'Post Author' }),
    authorLeader: await createUser(),
    secondTeamLeader: await createUser(),
    teammate: await createUser(),
    otherLeader: await createUser(),
    noTeam: await createUser(),
  };
  await addMember(users.author.id, team.id);
  await addMember(users.author.id, secondTeam.id);
  await addMember(users.authorLeader.id, team.id, 'TEAM_LEADER');
  await addMember(users.secondTeamLeader.id, secondTeam.id, 'TEAM_LEADER');
  await addMember(users.teammate.id, team.id);
  await addMember(users.otherLeader.id, otherTeam.id, 'TEAM_LEADER');
  clients = {
    admin: await loginAs(await getAdmin()),
    author: await loginAs(users.author),
    authorLeader: await loginAs(users.authorLeader),
    secondTeamLeader: await loginAs(users.secondTeamLeader),
    teammate: await loginAs(users.teammate),
    otherLeader: await loginAs(users.otherLeader),
    noTeam: await loginAs(users.noTeam),
  };
});

const post = async (client: Client, kind: 'NEWS' | 'TOPIC' = 'TOPIC') => {
  const res = await client.post('/api/posts', { kind, title: 'A title', body: 'Some text' }).expect(201);
  return res.body.id as string;
};
const answer = async (client: Client, topicId: string) => {
  const res = await client.post(`/api/posts/${topicId}/answers`, { body: 'An answer' }).expect(201);
  return res.body.id as string;
};

const ALL: Name[] = ['admin', 'author', 'authorLeader', 'secondTeamLeader', 'teammate', 'otherLeader', 'noTeam'];
const CAN_MODERATE: Name[] = ['admin', 'author', 'authorLeader', 'secondTeamLeader'];

describe.each(ALL)('%s', (name) => {
  it('can read and create news and topics, and answer topics', async () => {
    const client = clients[name];
    const newsId = await post(client, 'NEWS');
    const topicId = await post(client, 'TOPIC');
    await answer(client, topicId);
    await client.get(`/api/posts/${newsId}`).expect(200);
    await client.get('/api/posts?kind=NEWS').expect(200);
    await client.get('/api/posts?kind=TOPIC').expect(200);
  });

  const allowed = CAN_MODERATE.includes(name);

  it(`${allowed ? 'can' : 'cannot'} edit the author's post and answer`, async () => {
    const topicId = await post(clients.author);
    const answerId = await answer(clients.author, topicId);
    const status = allowed ? 204 : 403;
    await clients[name].patch(`/api/posts/${topicId}`, { body: 'Changed' }).expect(status);
    await clients[name].patch(`/api/answers/${answerId}`, { body: 'Changed' }).expect(status);
    const view = await clients[name].get(`/api/posts/${topicId}`).expect(200);
    expect(view.body.canEdit).toBe(allowed);
    expect(view.body.answers[0].canEdit).toBe(allowed);
  });

  it(`${allowed ? 'can' : 'cannot'} delete the author's post and answer`, async () => {
    const topicId = await post(clients.author);
    const answerId = await answer(clients.author, topicId);
    const status = allowed ? 204 : 403;
    await clients[name].delete(`/api/answers/${answerId}`).expect(status);
    await clients[name].delete(`/api/posts/${topicId}`).expect(status);
  });
});

describe('TeamLeader moderation', () => {
  it('covers co-leaders', async () => {
    const coLeader = await createUser();
    await addMember(coLeader.id, teamId, 'TEAM_LEADER');
    const id = await post(await loginAs(coLeader));
    await clients.authorLeader.patch(`/api/posts/${id}`, { title: 'Edited' }).expect(204);
  });

  it('does not reach the Admin', async () => {
    const id = await post(clients.admin);
    await clients.authorLeader.patch(`/api/posts/${id}`, { title: 'Edited' }).expect(403);
  });

  it('ends as soon as the author leaves the team', async () => {
    const user = await createUser();
    await addMember(user.id, teamId);
    const client = await loginAs(user);
    const id = await post(client);
    await clients.authorLeader.patch(`/api/posts/${id}`, { title: 'While member' }).expect(204);
    await client.post(`/api/teams/${teamId}/leave`).expect(204);
    await clients.authorLeader.patch(`/api/posts/${id}`, { title: 'After leaving' }).expect(403);
  });

  it('continues for a deactivated author, whose content stays visible', async () => {
    const user = await createUser();
    await addMember(user.id, teamId);
    const id = await post(await loginAs(user));
    await clients.admin.post(`/api/users/${user.id}/deactivate`).expect(204);
    const view = await clients.noTeam.get(`/api/posts/${id}`).expect(200);
    expect(view.body.author.deactivated).toBe(true);
    await clients.authorLeader.delete(`/api/posts/${id}`).expect(204);
  });
});

describe('deleting', () => {
  it('hides a post from everyone, including the Admin, but keeps the row', async () => {
    const id = await post(clients.author);
    await clients.author.delete(`/api/posts/${id}`).expect(204);
    await clients.admin.get(`/api/posts/${id}`).expect(404);
    await clients.author.delete(`/api/posts/${id}`).expect(404);
    const list = await clients.admin.get('/api/posts?kind=TOPIC&pageSize=100').expect(200);
    expect(list.body.items.map((p: { id: string }) => p.id)).not.toContain(id);
    const row = await db.post.findUniqueOrThrow({ where: { id } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.deletedById).toBe(clients.author.id);
  });

  it('hides the answers of a deleted topic', async () => {
    const id = await post(clients.author);
    const answerId = await answer(clients.teammate, id);
    await clients.author.delete(`/api/posts/${id}`).expect(204);
    await clients.teammate.patch(`/api/answers/${answerId}`, { body: 'Late' }).expect(404);
    await clients.teammate.delete(`/api/answers/${answerId}`).expect(404);
    await clients.teammate.post(`/api/posts/${id}/answers`, { body: 'Late' }).expect(404);
  });

  it('removes a deleted answer from the topic and its count', async () => {
    const id = await post(clients.author);
    const keep = await answer(clients.author, id);
    const remove = await answer(clients.author, id);
    await clients.author.delete(`/api/answers/${remove}`).expect(204);
    const view = await clients.noTeam.get(`/api/posts/${id}`).expect(200);
    expect(view.body.answers.map((a: { id: string }) => a.id)).toEqual([keep]);
    const list = await clients.noTeam.get('/api/posts?kind=TOPIC&pageSize=100').expect(200);
    expect(list.body.items.find((p: { id: string }) => p.id === id).answerCount).toBe(1);
  });
});

describe('audit records', () => {
  it('capture edits and deletions by someone other than the author, with the old text', async () => {
    const id = await post(clients.author);
    await clients.authorLeader.patch(`/api/posts/${id}`, { body: 'Replaced' }).expect(204);
    await clients.admin.delete(`/api/posts/${id}`).expect(204);
    const [edited] = await auditEntries('CONTENT_EDITED', id);
    const [deleted] = await auditEntries('CONTENT_DELETED', id);
    expect(edited?.actorId).toBe(clients.authorLeader.id);
    expect(edited?.details).toMatchObject({ authorId: clients.author.id, body: 'Some text' });
    expect(deleted?.details).toMatchObject({ body: 'Replaced' });
  });

  it('capture answers too', async () => {
    const id = await post(clients.author);
    const answerId = await answer(clients.author, id);
    await clients.admin.delete(`/api/answers/${answerId}`).expect(204);
    expect(await auditEntries('CONTENT_DELETED', answerId)).toHaveLength(1);
  });

  it('skip authors changing their own content', async () => {
    const id = await post(clients.author);
    await clients.author.patch(`/api/posts/${id}`, { body: 'Mine' }).expect(204);
    await clients.author.delete(`/api/posts/${id}`).expect(204);
    expect(await auditEntries('CONTENT_EDITED', id)).toHaveLength(0);
    expect(await auditEntries('CONTENT_DELETED', id)).toHaveLength(0);
  });
});

describe('validation and details', () => {
  it('allows answers on topics only', async () => {
    const newsId = await post(clients.author, 'NEWS');
    await clients.author.post(`/api/posts/${newsId}/answers`, { body: 'No' }).expect(400);
  });

  it('rejects blank text, unknown kinds and a supplied author', async () => {
    const { author } = clients;
    await author.post('/api/posts', { kind: 'TOPIC', title: '  ', body: 'x' }).expect(400);
    await author.post('/api/posts', { kind: 'TOPIC', title: 'x', body: '  ' }).expect(400);
    await author.post('/api/posts', { kind: 'POLL', title: 'x', body: 'x' }).expect(400);
    await author.post('/api/posts', { kind: 'TOPIC', title: 'x', body: 'x', authorId: clients.admin.id }).expect(400);
    await author.get('/api/posts').expect(400);
  });

  it('keeps a post\'s kind and author fixed when editing', async () => {
    const id = await post(clients.author);
    await clients.author.patch(`/api/posts/${id}`, { kind: 'NEWS' }).expect(400);
    await clients.author.patch(`/api/posts/${id}`, { authorId: clients.admin.id }).expect(400);
  });

  it('marks edited content, and keeps kinds separate', async () => {
    const id = await post(clients.author, 'NEWS');
    await clients.author.patch(`/api/posts/${id}`, { title: 'New title' }).expect(204);
    const view = await clients.noTeam.get(`/api/posts/${id}`).expect(200);
    expect(view.body.editedAt).toBeTruthy();
    const topics = await clients.noTeam.get('/api/posts?kind=TOPIC&pageSize=100').expect(200);
    expect(topics.body.items.map((p: { id: string }) => p.id)).not.toContain(id);
  });

  it('searches titles', async () => {
    await clients.author.post('/api/posts', { kind: 'NEWS', title: 'Quarterly picnic', body: 'x' }).expect(201);
    const res = await clients.noTeam.get('/api/posts?kind=NEWS&q=PICNIC').expect(200);
    expect(res.body.items).toHaveLength(1);
  });

  it('needs a login', async () => {
    const { default: request } = await import('supertest');
    const { app } = await import('./helpers.ts');
    await request(app).get('/api/posts?kind=NEWS').expect(401);
  });
});
