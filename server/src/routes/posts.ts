import { Router, type Request } from 'express';
import { z } from 'zod';
import { db, Prisma, type Tx } from '../db.ts';
import { audit, clientIp } from '../lib/audit.ts';
import { avatarUrl } from '../lib/avatars.ts';
import { ApiError, forbidden, notFound } from '../lib/errors.ts';
import { canEditContent, type Actor } from '../lib/policy.ts';
import { pageSchema, param } from '../lib/schemas.ts';
import { actor, requireAuth } from '../middleware/auth.ts';

export const postsRouter = Router();
export const answersRouter = Router();
postsRouter.use(requireAuth);
answersRouter.use(requireAuth);

const authorInclude = {
  select: {
    id: true,
    name: true,
    avatarPath: true,
    status: true,
    memberships: { select: { teamId: true } },
  },
} satisfies Prisma.UserDefaultArgs;

type Author = Prisma.UserGetPayload<typeof authorInclude>;

const canEdit = (me: Actor, author: Author) =>
  canEditContent(me, author.id, author.memberships.map((m) => m.teamId));

const presentAuthor = (author: Author) => ({
  id: author.id,
  name: author.name,
  avatarUrl: avatarUrl(author.avatarPath),
  deactivated: author.status === 'DEACTIVATED',
});

const AUDIT_TEXT_LIMIT = 2000;

/**
 * Records edits and deletions made by someone other than the author, with the text as it
 * was before the change, so moderation can be reviewed after the content has gone.
 */
function auditModeration(
  tx: Tx,
  req: Request,
  action: 'CONTENT_EDITED' | 'CONTENT_DELETED',
  targetType: 'Post' | 'Answer',
  targetId: string,
  authorId: string,
  previous: { title?: string; body: string },
) {
  const me = actor(req);
  if (me.id === authorId) return;
  return audit(tx, {
    actor: me,
    action,
    targetType,
    targetId,
    details: { authorId, ...previous, body: previous.body.slice(0, AUDIT_TEXT_LIMIT) },
    ip: clientIp(req),
  });
}

const titleSchema = z.string().trim().min(1, 'Enter a title.').max(200);
const bodySchema = z.string().trim().min(1, 'Enter some text.').max(20_000);

const listQuery = pageSchema.extend({ kind: z.enum(['NEWS', 'TOPIC']) });

postsRouter.get('/', async (req, res) => {
  const me = actor(req);
  const { kind, q, page, pageSize } = listQuery.parse(req.query);
  const where: Prisma.PostWhereInput = {
    kind,
    deletedAt: null,
    ...(q ? { title: { contains: q, mode: 'insensitive' as const } } : {}),
  };
  const [posts, total] = await Promise.all([
    db.post.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        author: authorInclude,
        _count: { select: { answers: { where: { deletedAt: null } } } },
      },
    }),
    db.post.count({ where }),
  ]);
  res.json({
    total,
    items: posts.map((post) => ({
      id: post.id,
      kind: post.kind,
      title: post.title,
      excerpt: post.body.slice(0, 240),
      author: presentAuthor(post.author),
      createdAt: post.createdAt,
      editedAt: post.editedAt,
      answerCount: post._count.answers,
      canEdit: canEdit(me, post.author),
    })),
  });
});

const createBody = z.strictObject({ kind: z.enum(['NEWS', 'TOPIC']), title: titleSchema, body: bodySchema });

postsRouter.post('/', async (req, res) => {
  const me = actor(req);
  const data = createBody.parse(req.body);
  const post = await db.post.create({ data: { ...data, authorId: me.id } });
  res.status(201).json({ id: post.id });
});

async function findPost(tx: Tx, id: string) {
  const post = await tx.post.findFirst({ where: { id, deletedAt: null }, include: { author: authorInclude } });
  if (!post) throw notFound('This post does not exist or was deleted.');
  return post;
}

postsRouter.get('/:id', async (req, res) => {
  const me = actor(req);
  const id = param(req.params.id);
  const post = await findPost(db, id);
  const answers = await db.answer.findMany({
    where: { postId: id, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    include: { author: authorInclude },
  });
  res.json({
    id: post.id,
    kind: post.kind,
    title: post.title,
    body: post.body,
    author: presentAuthor(post.author),
    createdAt: post.createdAt,
    editedAt: post.editedAt,
    canEdit: canEdit(me, post.author),
    answers: answers.map((answer) => ({
      id: answer.id,
      body: answer.body,
      author: presentAuthor(answer.author),
      createdAt: answer.createdAt,
      editedAt: answer.editedAt,
      canEdit: canEdit(me, answer.author),
    })),
  });
});

const editBody = z.strictObject({ title: titleSchema.optional(), body: bodySchema.optional() });

postsRouter.patch('/:id', async (req, res) => {
  const me = actor(req);
  const id = param(req.params.id);
  const changes = editBody.parse(req.body);
  await db.$transaction(async (tx) => {
    const post = await findPost(tx, id);
    if (!canEdit(me, post.author)) throw forbidden('You cannot edit this post.');
    await tx.post.update({ where: { id }, data: { ...changes, editedAt: new Date() } });
    await auditModeration(tx, req, 'CONTENT_EDITED', 'Post', id, post.authorId, { title: post.title, body: post.body });
  });
  res.status(204).end();
});

postsRouter.delete('/:id', async (req, res) => {
  const me = actor(req);
  const id = param(req.params.id);
  await db.$transaction(async (tx) => {
    const post = await findPost(tx, id);
    if (!canEdit(me, post.author)) throw forbidden('You cannot delete this post.');
    // Answers need no change: they are only ever reached through a post that is not deleted.
    await tx.post.update({ where: { id }, data: { deletedAt: new Date(), deletedById: me.id } });
    await auditModeration(tx, req, 'CONTENT_DELETED', 'Post', id, post.authorId, { title: post.title, body: post.body });
  });
  res.status(204).end();
});

const answerBody = z.strictObject({ body: bodySchema });

postsRouter.post('/:id/answers', async (req, res) => {
  const me = actor(req);
  const id = param(req.params.id);
  const { body } = answerBody.parse(req.body);
  const answer = await db.$transaction(async (tx) => {
    const post = await findPost(tx, id);
    if (post.kind !== 'TOPIC') throw new ApiError(400, 'NOT_A_TOPIC', 'Only forum topics can be answered.');
    return tx.answer.create({ data: { postId: id, body, authorId: me.id } });
  });
  res.status(201).json({ id: answer.id });
});

/** An answer under a deleted topic counts as deleted too. */
async function findAnswer(tx: Tx, id: string) {
  const answer = await tx.answer.findFirst({
    where: { id, deletedAt: null, post: { deletedAt: null } },
    include: { author: authorInclude },
  });
  if (!answer) throw notFound('This answer does not exist or was deleted.');
  return answer;
}

answersRouter.patch('/:id', async (req, res) => {
  const me = actor(req);
  const id = param(req.params.id);
  const { body } = answerBody.parse(req.body);
  await db.$transaction(async (tx) => {
    const answer = await findAnswer(tx, id);
    if (!canEdit(me, answer.author)) throw forbidden('You cannot edit this answer.');
    await tx.answer.update({ where: { id }, data: { body, editedAt: new Date() } });
    await auditModeration(tx, req, 'CONTENT_EDITED', 'Answer', id, answer.authorId, { body: answer.body });
  });
  res.status(204).end();
});

answersRouter.delete('/:id', async (req, res) => {
  const me = actor(req);
  const id = param(req.params.id);
  await db.$transaction(async (tx) => {
    const answer = await findAnswer(tx, id);
    if (!canEdit(me, answer.author)) throw forbidden('You cannot delete this answer.');
    await tx.answer.update({ where: { id }, data: { deletedAt: new Date(), deletedById: me.id } });
    await auditModeration(tx, req, 'CONTENT_DELETED', 'Answer', id, answer.authorId, { body: answer.body });
  });
  res.status(204).end();
});
