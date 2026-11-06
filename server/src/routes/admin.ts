import { Router } from 'express';
import { z } from 'zod';
import { db, Prisma } from '../db.ts';
import { forbidden } from '../lib/errors.ts';
import { canSeeAuditLog } from '../lib/policy.ts';
import { actor, requireAuth } from '../middleware/auth.ts';

export const adminRouter = Router();
adminRouter.use(requireAuth, (req, _res, next) => {
  if (!canSeeAuditLog(actor(req))) throw forbidden();
  next();
});

type AuditRow = Awaited<ReturnType<typeof db.auditLog.findMany>>[number];

/** Adds the current name of each target, because entries store only its id. */
async function present(rows: AuditRow[]) {
  const idsOf = (type: string) => [
    ...new Set(rows.filter((r) => r.targetType === type && r.targetId).map((r) => r.targetId as string)),
  ];
  const [users, teams] = await Promise.all([
    db.user.findMany({ where: { id: { in: idsOf('User') } }, select: { id: true, name: true } }),
    db.team.findMany({ where: { id: { in: idsOf('Team') } }, select: { id: true, name: true } }),
  ]);
  const names = new Map([...users, ...teams].map((item) => [item.id, item.name]));
  return rows.map((row) => ({
    // BigInt has no JSON form.
    id: row.id.toString(),
    action: row.action,
    actorId: row.actorId,
    actorName: row.actorName,
    targetType: row.targetType,
    targetId: row.targetId,
    targetName: row.targetId ? (names.get(row.targetId) ?? null) : null,
    details: row.details,
    ip: row.ip,
    createdAt: row.createdAt,
  }));
}

const auditQuery = z.object({
  action: z.string().trim().max(60).optional(),
  actor: z.string().trim().max(100).optional(),
  from: z.coerce.date().optional(),
  /** Exclusive upper bound. */
  to: z.coerce.date().optional(),
  /** Entries older than this id, for the next page. */
  before: z.coerce.bigint().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

adminRouter.get('/audit', async (req, res) => {
  const { action, actor: actorName, from, to, before, limit } = auditQuery.parse(req.query);
  const where: Prisma.AuditLogWhereInput = {
    ...(action ? { action } : {}),
    ...(actorName ? { actorName: { contains: actorName, mode: 'insensitive' as const } } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
    ...(before ? { id: { lt: before } } : {}),
  };
  const rows = await db.auditLog.findMany({ where, orderBy: { id: 'desc' }, take: limit + 1 });
  const page = rows.slice(0, limit);
  res.json({
    items: await present(page),
    nextBefore: rows.length > limit ? (page.at(-1)?.id.toString() ?? null) : null,
  });
});

adminRouter.get('/audit/actions', async (_req, res) => {
  const actions = await db.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } });
  res.json(actions.map((a) => a.action));
});

adminRouter.get('/summary', async (_req, res) => {
  const [statuses, teamCount, pending, leaderless, recent] = await Promise.all([
    db.user.groupBy({ by: ['status'], _count: true }),
    db.team.count(),
    db.user.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, email: true, createdAt: true },
    }),
    db.team.findMany({
      where: { memberships: { none: { role: 'TEAM_LEADER', user: { status: 'ACTIVE' } } } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    db.auditLog.findMany({ orderBy: { id: 'desc' }, take: 10 }),
  ]);
  const count = (status: string) => statuses.find((s) => s.status === status)?._count ?? 0;
  res.json({
    counts: {
      active: count('ACTIVE'),
      pending: count('PENDING'),
      deactivated: count('DEACTIVATED'),
      teams: teamCount,
    },
    pending,
    leaderlessTeams: leaderless,
    recentActivity: await present(recent),
  });
});
