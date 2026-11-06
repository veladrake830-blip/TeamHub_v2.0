import { Router, type Request } from 'express';
import { z } from 'zod';
import { config } from '../config.ts';
import { db, type Tx } from '../db.ts';
import { audit, clientIp } from '../lib/audit.ts';
import { avatarUpload, avatarUrl, removeAvatar, saveAvatar } from '../lib/avatars.ts';
import { ApiError, badRequest, conflict, forbidden, notFound } from '../lib/errors.ts';
import {
  canChangeRoles,
  canCreateTeam,
  canEditTeamInfo,
  canLeaveTeam,
  canManageMembers,
  canRemoveOrDemoteLeader,
} from '../lib/policy.ts';
import { idSchema, nameSchema, pageSchema, param, sloganSchema } from '../lib/schemas.ts';
import { actor, requireAdmin, requireAuth } from '../middleware/auth.ts';

export const teamsRouter = Router();
export const invitationsRouter = Router();
teamsRouter.use(requireAuth);
invitationsRouter.use(requireAuth);

/**
 * Takes a row lock on the team. Every change to membership runs under this lock, so two
 * leaders cannot both leave at once and leave the team with nobody in charge.
 */
async function lockTeam(tx: Tx, teamId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Team" WHERE "id" = ${teamId}::uuid FOR UPDATE`;
  if (rows.length === 0) throw notFound('Team not found.');
}

async function activeLeaderIds(tx: Tx, teamId: string) {
  const leaders = await tx.membership.findMany({
    where: { teamId, role: 'TEAM_LEADER', user: { status: 'ACTIVE' } },
    select: { userId: true },
  });
  return leaders.map((l) => l.userId);
}

/** Only active accounts can be invited or appointed, and the Admin is never a member. */
async function requireJoinableUser(tx: Tx, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound('User not found.');
  if (user.isAdmin) throw badRequest('The Admin cannot join a team.');
  if (user.status !== 'ACTIVE') throw badRequest('Only active accounts can join a team.');
  return user;
}

function auditTeam(tx: Tx, req: Request, action: string, teamId: string, details?: Record<string, string>) {
  return audit(tx, {
    actor: actor(req),
    action,
    targetType: 'Team',
    targetId: teamId,
    details,
    ip: clientIp(req),
  });
}

teamsRouter.get('/', async (req, res) => {
  const { q, page, pageSize } = pageSchema.parse(req.query);
  const where = q ? { name: { contains: q, mode: 'insensitive' as const } } : {};
  const [teams, total] = await Promise.all([
    db.team.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { _count: { select: { memberships: true } } },
    }),
    db.team.count({ where }),
  ]);
  res.json({
    total,
    items: teams.map((t) => ({
      id: t.id,
      name: t.name,
      slogan: t.slogan,
      avatarUrl: avatarUrl(t.avatarPath),
      memberCount: t._count.memberships,
    })),
  });
});

const createBody = z.strictObject({ name: nameSchema, slogan: sloganSchema.optional(), leaderId: idSchema });

teamsRouter.post('/', async (req, res) => {
  const me = actor(req);
  if (!canCreateTeam(me)) throw forbidden();
  const { leaderId, ...data } = createBody.parse(req.body);
  const team = await db.$transaction(async (tx) => {
    await requireJoinableUser(tx, leaderId);
    const created = await tx.team.create({ data });
    await tx.membership.create({ data: { teamId: created.id, userId: leaderId, role: 'TEAM_LEADER' } });
    await auditTeam(tx, req, 'TEAM_CREATED', created.id, { name: created.name, leaderId });
    return created;
  });
  res.status(201).json({ id: team.id });
});

teamsRouter.get('/:id', async (req, res) => {
  const me = actor(req);
  const id = param(req.params.id);
  const team = await db.team.findUnique({
    where: { id },
    include: { memberships: { include: { user: true }, orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }] } },
  });
  if (!team) throw notFound('Team not found.');

  const manages = canManageMembers(me, id);
  const [invitations, joinRequests, myInvitation, myJoinRequest, following] = await Promise.all([
    manages
      ? db.invitation.findMany({ where: { teamId: id, status: 'PENDING' }, include: { user: true } })
      : [],
    manages
      ? db.joinRequest.findMany({ where: { teamId: id, status: 'PENDING' }, include: { user: true } })
      : [],
    db.invitation.findFirst({ where: { teamId: id, userId: me.id, status: 'PENDING' } }),
    db.joinRequest.findFirst({ where: { teamId: id, userId: me.id, status: 'PENDING' } }),
    db.teamFollow.findUnique({ where: { userId_teamId: { userId: me.id, teamId: id } } }),
  ]);

  const person = (u: { id: string; name: string; avatarPath: string | null }) => ({
    id: u.id,
    name: u.name,
    avatarUrl: avatarUrl(u.avatarPath),
  });
  const activeLeaders = team.memberships.filter((m) => m.role === 'TEAM_LEADER' && m.user.status === 'ACTIVE');

  res.json({
    id: team.id,
    name: team.name,
    slogan: team.slogan,
    avatarUrl: avatarUrl(team.avatarPath),
    members: team.memberships.map((m) => ({
      ...person(m.user),
      role: m.role,
      deactivated: m.user.status === 'DEACTIVATED',
      joinedAt: m.joinedAt,
    })),
    hasActiveLeader: activeLeaders.length > 0,
    myRole: me.teams.get(id) ?? null,
    myInvitationId: myInvitation?.id ?? null,
    myJoinRequestId: myJoinRequest?.id ?? null,
    isFollowing: Boolean(following),
    canManage: manages,
    invitations: invitations.map((i) => ({ id: i.id, user: person(i.user), createdAt: i.createdAt })),
    joinRequests: joinRequests.map((r) => ({ id: r.id, user: person(r.user), createdAt: r.createdAt })),
  });
});

const teamInfoBody = z.strictObject({ name: nameSchema.optional(), slogan: sloganSchema.optional() });

teamsRouter.patch('/:id', async (req, res) => {
  const me = actor(req);
  const id = param(req.params.id);
  if (!canEditTeamInfo(me, id)) throw forbidden();
  const changes = teamInfoBody.parse(req.body);
  await db.$transaction(async (tx) => {
    await lockTeam(tx, id);
    const current = await tx.team.findUniqueOrThrow({ where: { id } });
    const changed = (['name', 'slogan'] as const).filter(
      (field) => changes[field] !== undefined && changes[field] !== current[field],
    );
    if (changed.length === 0) return;
    await tx.team.update({ where: { id }, data: changes });
    await auditTeam(tx, req, 'TEAM_UPDATED', id, { fields: changed.join(',') });
  });
  res.status(204).end();
});

teamsRouter.put('/:id/avatar', avatarUpload, async (req, res) => {
  const me = actor(req);
  const id = param(req.params.id);
  if (!canEditTeamInfo(me, id)) throw forbidden();
  const name = await saveAvatar(req.file);
  const old = await db.$transaction(async (tx) => {
    await lockTeam(tx, id);
    const team = await tx.team.findUniqueOrThrow({ where: { id } });
    await tx.team.update({ where: { id }, data: { avatarPath: name } });
    await auditTeam(tx, req, 'TEAM_UPDATED', id, { fields: 'avatar' });
    return team.avatarPath;
  });
  await removeAvatar(old);
  res.json({ avatarUrl: avatarUrl(name) });
});

teamsRouter.put('/:id/follow', async (req, res) => {
  const userId = actor(req).id;
  const teamId = param(req.params.id);
  if (!(await db.team.findUnique({ where: { id: teamId } }))) throw notFound('Team not found.');
  await db.teamFollow.upsert({
    where: { userId_teamId: { userId, teamId } },
    create: { userId, teamId },
    update: {},
  });
  res.status(204).end();
});

teamsRouter.delete('/:id/follow', async (req, res) => {
  await db.teamFollow.deleteMany({ where: { userId: actor(req).id, teamId: param(req.params.id) } });
  res.status(204).end();
});

// Invitations.

const userBody = z.strictObject({ userId: idSchema });

teamsRouter.post('/:id/invitations', async (req, res) => {
  const me = actor(req);
  const teamId = param(req.params.id);
  if (!canManageMembers(me, teamId)) throw forbidden();
  const { userId } = userBody.parse(req.body);
  const invitation = await db.$transaction(async (tx) => {
    await lockTeam(tx, teamId);
    await requireJoinableUser(tx, userId);
    if (await tx.membership.findUnique({ where: { userId_teamId: { userId, teamId } } })) {
      throw conflict('ALREADY_MEMBER', 'This user is already on the team.');
    }
    if (await tx.invitation.findFirst({ where: { teamId, userId, status: 'PENDING' } })) {
      throw conflict('ALREADY_INVITED', 'This user already has a pending invitation.');
    }
    const created = await tx.invitation.create({ data: { teamId, userId, invitedById: me.id } });
    await auditTeam(tx, req, 'MEMBER_INVITED', teamId, { userId });
    return created;
  });
  res.status(201).json({ id: invitation.id });
});

teamsRouter.delete('/:id/invitations/:invitationId', async (req, res) => {
  const me = actor(req);
  const teamId = param(req.params.id);
  const invitationId = param(req.params.invitationId);
  if (!canManageMembers(me, teamId)) throw forbidden();
  await db.$transaction(async (tx) => {
    const { count } = await tx.invitation.updateMany({
      where: { id: invitationId, teamId, status: 'PENDING' },
      data: { status: 'CANCELLED', respondedAt: new Date() },
    });
    if (count === 0) throw notFound('Invitation not found.');
    await auditTeam(tx, req, 'INVITATION_CANCELLED', teamId, { invitationId });
  });
  res.status(204).end();
});

invitationsRouter.get('/', async (req, res) => {
  const invitations = await db.invitation.findMany({
    where: { userId: actor(req).id, status: 'PENDING' },
    include: { team: true, invitedBy: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(
    invitations.map((i) => ({
      id: i.id,
      team: { id: i.team.id, name: i.team.name, avatarUrl: avatarUrl(i.team.avatarPath) },
      invitedBy: i.invitedBy.name,
      createdAt: i.createdAt,
    })),
  );
});

async function myPendingInvitation(tx: Tx, id: string, userId: string) {
  const invitation = await tx.invitation.findFirst({ where: { id, userId, status: 'PENDING' } });
  if (!invitation) throw notFound('Invitation not found.');
  return invitation;
}

invitationsRouter.post('/:id/accept', async (req, res) => {
  const me = actor(req);
  const id = param(req.params.id);
  await db.$transaction(async (tx) => {
    const { teamId } = await myPendingInvitation(tx, id, me.id);
    await lockTeam(tx, teamId);
    // Conditional, so that an invitation cancelled at this same moment can't still be accepted.
    const { count } = await tx.invitation.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'ACCEPTED', respondedAt: new Date() },
    });
    if (count === 0) throw notFound('Invitation not found.');
    await tx.membership.create({ data: { teamId, userId: me.id } });
    await tx.joinRequest.updateMany({
      where: { teamId, userId: me.id, status: 'PENDING' },
      data: { status: 'CANCELLED', decidedAt: new Date() },
    });
    await auditTeam(tx, req, 'INVITATION_ACCEPTED', teamId, { invitationId: id });
  });
  res.status(204).end();
});

invitationsRouter.post('/:id/decline', async (req, res) => {
  const me = actor(req);
  const id = param(req.params.id);
  await db.$transaction(async (tx) => {
    const { teamId } = await myPendingInvitation(tx, id, me.id);
    await tx.invitation.update({ where: { id }, data: { status: 'DECLINED', respondedAt: new Date() } });
    await auditTeam(tx, req, 'INVITATION_DECLINED', teamId, { invitationId: id });
  });
  res.status(204).end();
});

// Join requests.

teamsRouter.post('/:id/join-requests', async (req, res) => {
  const me = actor(req);
  const teamId = param(req.params.id);
  if (me.isAdmin) throw badRequest('The Admin cannot join a team.');
  if (me.teams.has(teamId)) throw conflict('ALREADY_MEMBER', 'You are already on this team.');
  const request = await db.$transaction(async (tx) => {
    await lockTeam(tx, teamId);
    if (await tx.joinRequest.findFirst({ where: { teamId, userId: me.id, status: 'PENDING' } })) {
      throw conflict('ALREADY_REQUESTED', 'You already have a pending request for this team.');
    }
    const created = await tx.joinRequest.create({ data: { teamId, userId: me.id } });
    await auditTeam(tx, req, 'JOIN_REQUESTED', teamId, { userId: me.id });
    return created;
  });
  res.status(201).json({ id: request.id });
});

teamsRouter.delete('/:id/join-requests/:requestId', async (req, res) => {
  const me = actor(req);
  const teamId = param(req.params.id);
  const requestId = param(req.params.requestId);
  await db.$transaction(async (tx) => {
    const { count } = await tx.joinRequest.updateMany({
      where: { id: requestId, teamId, userId: me.id, status: 'PENDING' },
      data: { status: 'CANCELLED', decidedAt: new Date() },
    });
    if (count === 0) throw notFound('Join request not found.');
    await auditTeam(tx, req, 'JOIN_REQUEST_CANCELLED', teamId, { requestId });
  });
  res.status(204).end();
});

teamsRouter.post('/:id/join-requests/:requestId/:decision', async (req, res) => {
  const me = actor(req);
  const teamId = param(req.params.id);
  const requestId = param(req.params.requestId);
  const decision = z.enum(['approve', 'reject']).parse(req.params.decision);
  if (!canManageMembers(me, teamId)) throw forbidden();

  await db.$transaction(async (tx) => {
    await lockTeam(tx, teamId);
    const request = await tx.joinRequest.findFirst({ where: { id: requestId, teamId, status: 'PENDING' } });
    if (!request) throw notFound('Join request not found.');
    const decided = { decidedById: me.id, decidedAt: new Date() };

    if (decision === 'reject') {
      await tx.joinRequest.update({ where: { id: requestId }, data: { status: 'DECLINED', ...decided } });
      await auditTeam(tx, req, 'JOIN_REJECTED', teamId, { userId: request.userId });
      return;
    }
    await requireJoinableUser(tx, request.userId);
    await tx.joinRequest.update({ where: { id: requestId }, data: { status: 'ACCEPTED', ...decided } });
    await tx.membership.create({ data: { teamId, userId: request.userId } });
    await tx.invitation.updateMany({
      where: { teamId, userId: request.userId, status: 'PENDING' },
      data: { status: 'CANCELLED', respondedAt: new Date() },
    });
    await auditTeam(tx, req, 'JOIN_APPROVED', teamId, { userId: request.userId });
  });
  res.status(204).end();
});

// Membership.

/** Someone who just stopped leading stays out of reach of other leaders' reset links for a while. */
function lockResetLinks(tx: Tx, userId: string) {
  const resetLockedUntil = new Date(Date.now() + config.resetLockDays * 86_400_000);
  return tx.user.update({ where: { id: userId }, data: { resetLockedUntil } });
}

async function getMembership(tx: Tx, teamId: string, userId: string) {
  const membership = await tx.membership.findUnique({ where: { userId_teamId: { userId, teamId } } });
  if (!membership) throw notFound('This user is not on the team.');
  return membership;
}

const lastLeaderError = () =>
  new ApiError(409, 'LAST_LEADER', 'A team needs a TeamLeader. Appoint another one first.');

teamsRouter.post('/:id/leave', async (req, res) => {
  const me = actor(req);
  const teamId = param(req.params.id);
  await db.$transaction(async (tx) => {
    await lockTeam(tx, teamId);
    await getMembership(tx, teamId, me.id);
    if (!canLeaveTeam(me.id, await activeLeaderIds(tx, teamId))) throw lastLeaderError();
    await tx.membership.delete({ where: { userId_teamId: { userId: me.id, teamId } } });
    await auditTeam(tx, req, 'MEMBER_LEFT', teamId, { userId: me.id });
  });
  res.status(204).end();
});

teamsRouter.delete('/:id/members/:userId', async (req, res) => {
  const me = actor(req);
  const teamId = param(req.params.id);
  const userId = param(req.params.userId);
  if (!canManageMembers(me, teamId)) throw forbidden();
  await db.$transaction(async (tx) => {
    await lockTeam(tx, teamId);
    const membership = await getMembership(tx, teamId, userId);
    if (membership.role === 'TEAM_LEADER' && !canRemoveOrDemoteLeader(me, userId, await activeLeaderIds(tx, teamId))) {
      throw lastLeaderError();
    }
    if (membership.role === 'TEAM_LEADER') await lockResetLinks(tx, userId);
    await tx.membership.delete({ where: { userId_teamId: { userId, teamId } } });
    await auditTeam(tx, req, 'MEMBER_REMOVED', teamId, { userId });
  });
  res.status(204).end();
});

const roleBody = z.strictObject({ role: z.enum(['TEAM_LEADER', 'MEMBER']) });

teamsRouter.patch('/:id/members/:userId', async (req, res) => {
  const me = actor(req);
  const teamId = param(req.params.id);
  const userId = param(req.params.userId);
  if (!canChangeRoles(me, teamId)) throw forbidden();
  const { role } = roleBody.parse(req.body);
  await db.$transaction(async (tx) => {
    await lockTeam(tx, teamId);
    const membership = await getMembership(tx, teamId, userId);
    if (membership.role === role) return;
    if (role === 'TEAM_LEADER') await requireJoinableUser(tx, userId);
    if (role === 'MEMBER' && !canRemoveOrDemoteLeader(me, userId, await activeLeaderIds(tx, teamId))) {
      throw lastLeaderError();
    }
    if (role === 'MEMBER') await lockResetLinks(tx, userId);
    await tx.membership.update({ where: { userId_teamId: { userId, teamId } }, data: { role } });
    await auditTeam(tx, req, 'ROLE_CHANGED', teamId, { userId, from: membership.role, to: role });
  });
  res.status(204).end();
});

/** The Admin appoints a leader directly, for example after the last one is deactivated. */
teamsRouter.post('/:id/leaders', requireAdmin, async (req, res) => {
  const teamId = param(req.params.id);
  const { userId } = userBody.parse(req.body);
  await db.$transaction(async (tx) => {
    await lockTeam(tx, teamId);
    await requireJoinableUser(tx, userId);
    await tx.membership.upsert({
      where: { userId_teamId: { userId, teamId } },
      create: { teamId, userId, role: 'TEAM_LEADER' },
      update: { role: 'TEAM_LEADER' },
    });
    await tx.invitation.updateMany({
      where: { teamId, userId, status: 'PENDING' },
      data: { status: 'CANCELLED', respondedAt: new Date() },
    });
    await tx.joinRequest.updateMany({
      where: { teamId, userId, status: 'PENDING' },
      data: { status: 'CANCELLED', decidedAt: new Date() },
    });
    await auditTeam(tx, req, 'LEADER_APPOINTED', teamId, { userId });
  });
  res.status(204).end();
});
