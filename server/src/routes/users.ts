import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.ts';
import { db, Prisma, type Tx } from '../db.ts';
import { audit, clientIp } from '../lib/audit.ts';
import { avatarUpload, avatarUrl, removeAvatar, saveAvatar } from '../lib/avatars.ts';
import { ApiError, badRequest, conflict, forbidden, notFound } from '../lib/errors.ts';
import { hashPassword, passwordSchema, verifyPassword } from '../lib/passwords.ts';
import { canIssueResetLink, type Role, type Target } from '../lib/policy.ts';
import { issueResetLink, revokeResetLinks } from '../lib/resetLinks.ts';
import { emailSchema, nameSchema, pageSchema, param, sloganSchema } from '../lib/schemas.ts';
import { revokeAllSessions } from '../lib/sessions.ts';
import { actor, requireAdmin, requireAuth } from '../middleware/auth.ts';

export const usersRouter = Router();
usersRouter.use(requireAuth);

async function loadTarget(tx: Tx, id: string): Promise<Target & { name: string }> {
  const user = await tx.user.findUnique({ where: { id }, include: { memberships: true } });
  if (!user) throw notFound('User not found.');
  return {
    id: user.id,
    name: user.name,
    isAdmin: user.isAdmin,
    status: user.status,
    teams: new Map(user.memberships.map((m) => [m.teamId, m.role as Role])),
    resetLockedUntil: user.resetLockedUntil,
  };
}

/** Stops a stolen session being used to guess the account's password. */
const passwordCheckLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => actor(req).id,
  skip: (req) => !config.rateLimitEnabled || typeof req.body?.currentPassword !== 'string',
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again in a few minutes.' } },
});

const directoryQuery = pageSchema.extend({
  status: z.enum(['PENDING', 'ACTIVE', 'DEACTIVATED']).optional(),
});

usersRouter.get('/', async (req, res) => {
  const me = actor(req);
  const { q, page, pageSize, status } = directoryQuery.parse(req.query);
  // Only the Admin can see accounts that are not active, or anyone's email.
  const where: Prisma.UserWhereInput = {
    status: me.isAdmin ? status : 'ACTIVE',
    ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
  };
  const [users, total] = await Promise.all([
    db.user.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.user.count({ where }),
  ]);
  res.json({
    total,
    items: users.map((u) => ({
      id: u.id,
      name: u.name,
      avatarUrl: avatarUrl(u.avatarPath),
      slogan: u.slogan,
      ...(me.isAdmin ? { email: u.email, status: u.status } : {}),
    })),
  });
});

const profileBody = z.strictObject({
  name: nameSchema.optional(),
  slogan: sloganSchema.optional(),
  email: emailSchema.optional(),
  /** Required when changing email, because email is the login name. */
  currentPassword: z.string().max(200).optional(),
});

usersRouter.patch('/me', passwordCheckLimiter, async (req, res) => {
  const me = actor(req);
  const { currentPassword, ...changes } = profileBody.parse(req.body);
  const user = await db.user.findUniqueOrThrow({ where: { id: me.id } });

  if (changes.email && changes.email !== user.email) {
    const ok = user.passwordHash && currentPassword && (await verifyPassword(currentPassword, user.passwordHash));
    if (!ok) throw new ApiError(403, 'WRONG_PASSWORD', 'Enter your current password to change your email.');
  }

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: me.id }, data: changes });
    await audit(tx, {
      actor: me,
      action: 'PROFILE_UPDATED',
      targetType: 'User',
      targetId: me.id,
      details: { fields: Object.keys(changes) },
      ip: clientIp(req),
    });
  });
  res.status(204).end();
});

const preferencesBody = z.strictObject({ theme: z.enum(['SYSTEM', 'LIGHT', 'DARK']) });

usersRouter.put('/me/preferences', async (req, res) => {
  const { theme } = preferencesBody.parse(req.body);
  await db.user.update({ where: { id: actor(req).id }, data: { theme } });
  res.status(204).end();
});

const passwordBody = z.strictObject({ currentPassword: z.string().max(200), newPassword: passwordSchema });

usersRouter.put('/me/password', passwordCheckLimiter, async (req, res) => {
  const me = actor(req);
  const { currentPassword, newPassword } = passwordBody.parse(req.body);
  const user = await db.user.findUniqueOrThrow({ where: { id: me.id } });
  if (!user.passwordHash || !(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new ApiError(403, 'WRONG_PASSWORD', 'Your current password is incorrect.');
  }
  const passwordHash = await hashPassword(newPassword);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: me.id }, data: { passwordHash } });
    await revokeAllSessions(tx, me.id, me.sessionId);
    await revokeResetLinks(tx, me.id);
    await audit(tx, { actor: me, action: 'PASSWORD_CHANGED', targetType: 'User', targetId: me.id, ip: clientIp(req) });
  });
  res.status(204).end();
});

usersRouter.put('/me/avatar', avatarUpload, async (req, res) => {
  const me = actor(req);
  const name = await saveAvatar(req.file);
  const user = await db.user.findUniqueOrThrow({ where: { id: me.id } });
  await db.user.update({ where: { id: me.id }, data: { avatarPath: name } });
  await removeAvatar(user.avatarPath);
  res.json({ avatarUrl: avatarUrl(name) });
});

usersRouter.delete('/me/avatar', async (req, res) => {
  const me = actor(req);
  const user = await db.user.findUniqueOrThrow({ where: { id: me.id } });
  await db.user.update({ where: { id: me.id }, data: { avatarPath: null } });
  await removeAvatar(user.avatarPath);
  res.status(204).end();
});

usersRouter.get('/:id', async (req, res) => {
  const me = actor(req);
  const id = param(req.params.id);
  const user = await db.user.findUnique({
    where: { id },
    include: {
      memberships: { include: { team: true } },
      following: { include: { followee: true } },
      teamFollows: { include: { team: true } },
    },
  });
  // A deactivated user's profile stays reachable, because their posts and logs stay visible.
  // A pending account is not yet part of the organization.
  if (!user || (user.status === 'PENDING' && !me.isAdmin && user.id !== me.id)) throw notFound('User not found.');

  const target = await loadTarget(db, id);
  const isFollowing = await db.userFollow.findUnique({
    where: { followerId_followeeId: { followerId: me.id, followeeId: id } },
  });
  res.json({
    id: user.id,
    name: user.name,
    avatarUrl: avatarUrl(user.avatarPath),
    slogan: user.slogan,
    isAdmin: user.isAdmin,
    deactivated: user.status === 'DEACTIVATED',
    ...(me.isAdmin || me.id === id ? { email: user.email, status: user.status } : {}),
    teams: user.memberships.map((m) => ({
      id: m.team.id,
      name: m.team.name,
      avatarUrl: avatarUrl(m.team.avatarPath),
      role: m.role,
    })),
    followingUsers: user.following.map((f) => ({
      id: f.followee.id,
      name: f.followee.name,
      avatarUrl: avatarUrl(f.followee.avatarPath),
    })),
    followingTeams: user.teamFollows.map((f) => ({
      id: f.team.id,
      name: f.team.name,
      avatarUrl: avatarUrl(f.team.avatarPath),
    })),
    isFollowing: Boolean(isFollowing),
    canIssueResetLink: canIssueResetLink(me, target),
  });
});

usersRouter.put('/:id/follow', async (req, res) => {
  const me = actor(req);
  const id = param(req.params.id);
  if (id === me.id) throw badRequest('You cannot follow yourself.');
  await loadTarget(db, id);
  await db.userFollow.upsert({
    where: { followerId_followeeId: { followerId: me.id, followeeId: id } },
    create: { followerId: me.id, followeeId: id },
    update: {},
  });
  res.status(204).end();
});

usersRouter.delete('/:id/follow', async (req, res) => {
  const me = actor(req);
  const id = param(req.params.id);
  await db.userFollow.deleteMany({ where: { followerId: me.id, followeeId: id } });
  res.status(204).end();
});

usersRouter.post('/:id/reset-link', async (req, res) => {
  const me = actor(req);
  const id = param(req.params.id);
  const link = await db.$transaction(async (tx) => {
    const target = await loadTarget(tx, id);
    if (!canIssueResetLink(me, target)) throw forbidden('You cannot issue a reset link for this user.');
    const issued = await issueResetLink(tx, id, me.id);
    await audit(tx, {
      actor: me,
      action: 'PASSWORD_RESET_LINK_ISSUED',
      targetType: 'User',
      targetId: id,
      details: { targetName: target.name },
      ip: clientIp(req),
    });
    return issued;
  });
  res.status(201).json(link);
});

// Admin account management.

const addBody = z.strictObject({ name: nameSchema, email: emailSchema, slogan: sloganSchema.optional() });

usersRouter.post('/', requireAdmin, async (req, res) => {
  const me = actor(req);
  const body = addBody.parse(req.body);
  const result = await db.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { ...body, status: 'ACTIVE' } });
    const link = await issueResetLink(tx, user.id, me.id, 'FIRST_PASSWORD');
    await audit(tx, {
      actor: me,
      action: 'ACCOUNT_ADDED',
      targetType: 'User',
      targetId: user.id,
      details: { name: user.name, email: user.email },
      ip: clientIp(req),
    });
    return { id: user.id, firstPasswordLink: link };
  });
  res.status(201).json(result);
});

const adminEditBody = z.strictObject({
  name: nameSchema.optional(),
  email: emailSchema.optional(),
  slogan: sloganSchema.optional(),
});

usersRouter.patch('/:id', requireAdmin, async (req, res) => {
  const me = actor(req);
  const id = param(req.params.id);
  if (id === me.id) throw badRequest('Use your own profile page to edit your account.');
  const changes = adminEditBody.parse(req.body);
  await db.$transaction(async (tx) => {
    await loadTarget(tx, id);
    await tx.user.update({ where: { id }, data: changes });
    await audit(tx, {
      actor: me,
      action: 'ACCOUNT_EDITED',
      targetType: 'User',
      targetId: id,
      details: { fields: Object.keys(changes) },
      ip: clientIp(req),
    });
  });
  res.status(204).end();
});

/** Activates a pending account, or reactivates a deactivated one. */
usersRouter.post('/:id/activate', requireAdmin, async (req, res) => {
  const me = actor(req);
  const id = param(req.params.id);
  await db.$transaction(async (tx) => {
    const target = await loadTarget(tx, id);
    if (target.status === 'ACTIVE') throw conflict('ALREADY_ACTIVE', 'This account is already active.');
    await tx.user.update({ where: { id }, data: { status: 'ACTIVE' } });
    await audit(tx, {
      actor: me,
      action: target.status === 'PENDING' ? 'ACCOUNT_ACTIVATED' : 'ACCOUNT_REACTIVATED',
      targetType: 'User',
      targetId: id,
      ip: clientIp(req),
    });
  });
  res.status(204).end();
});

usersRouter.post('/:id/deactivate', requireAdmin, async (req, res) => {
  const me = actor(req);
  const id = param(req.params.id);
  await db.$transaction(async (tx) => {
    const target = await loadTarget(tx, id);
    if (target.isAdmin) throw forbidden('The Admin cannot be deactivated.');
    if (target.status === 'DEACTIVATED') throw conflict('ALREADY_DEACTIVATED', 'This account is already deactivated.');
    await tx.user.update({ where: { id }, data: { status: 'DEACTIVATED' } });
    await revokeAllSessions(tx, id);
    await revokeResetLinks(tx, id);
    // Team memberships stay, so TeamLeaders can still moderate this user's content.
    await tx.invitation.updateMany({
      where: { userId: id, status: 'PENDING' },
      data: { status: 'CANCELLED', respondedAt: new Date() },
    });
    await tx.joinRequest.updateMany({
      where: { userId: id, status: 'PENDING' },
      data: { status: 'CANCELLED', decidedAt: new Date() },
    });
    await audit(tx, { actor: me, action: 'ACCOUNT_DEACTIVATED', targetType: 'User', targetId: id, ip: clientIp(req) });
  });
  res.status(204).end();
});
