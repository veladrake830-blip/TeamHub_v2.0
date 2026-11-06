import { Router } from 'express';
import { z } from 'zod';
import { db, Prisma } from '../db.ts';
import { avatarUrl } from '../lib/avatars.ts';
import { addDays, dayIn, daySchema, fromDbDate, toDbDate, withinEditWindow } from '../lib/dates.ts';
import { ApiError, conflict, forbidden, notFound } from '../lib/errors.ts';
import { getTimezone } from '../lib/organization.ts';
import { canEditOwnLog, canRecordLogs, type Actor } from '../lib/policy.ts';
import { idSchema, pageSchema, param } from '../lib/schemas.ts';
import { actor, requireAuth } from '../middleware/auth.ts';

export const workLogsRouter = Router();
workLogsRouter.use(requireAuth);

const planInclude = {
  tasks: { orderBy: { position: 'asc' } },
  user: { select: { id: true, name: true, avatarPath: true, status: true } },
} satisfies Prisma.WorkPlanInclude;

type PlanRow = Prisma.WorkPlanGetPayload<{ include: typeof planInclude }>;

function present(plan: PlanRow, me: Actor, today: string) {
  const date = fromDbDate(plan.date);
  return {
    id: plan.id,
    date,
    user: {
      id: plan.user.id,
      name: plan.user.name,
      avatarUrl: avatarUrl(plan.user.avatarPath),
      deactivated: plan.user.status === 'DEACTIVATED',
    },
    tasks: plan.tasks.map((t) => ({ id: t.id, title: t.title, result: t.result })),
    updatedAt: plan.updatedAt,
    canEdit: canEditOwnLog(me, plan.userId, withinEditWindow(date, today)),
  };
}

const listQuery = pageSchema.omit({ q: true }).extend({
  /** One day across everyone, or with userId a single person's history. */
  date: daySchema.optional(),
  userId: idSchema.optional(),
  teamId: idSchema.optional(),
});

// Every logged-in user can read every work log, including the Admin and users without a team.
workLogsRouter.get('/', async (req, res) => {
  const me = actor(req);
  const { date, userId, teamId, page, pageSize } = listQuery.parse(req.query);
  const timezone = await getTimezone();
  const today = dayIn(timezone);

  const day = date ?? (userId ? undefined : today);
  const where: Prisma.WorkPlanWhereInput = {
    ...(day ? { date: toDbDate(day) } : {}),
    ...(userId ? { userId } : {}),
    ...(teamId ? { user: { memberships: { some: { teamId } } } } : {}),
  };
  const [plans, total] = await Promise.all([
    db.workPlan.findMany({
      where,
      include: planInclude,
      orderBy: userId ? { date: 'desc' } : [{ user: { name: 'asc' } }, { userId: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.workPlan.count({ where }),
  ]);

  res.json({
    total,
    today,
    timezone,
    canRecord: canRecordLogs(me),
    items: plans.map((plan) => present(plan, me, today)),
  });
});

const taskSchema = z.strictObject({
  title: z.string().trim().min(1, 'Each task needs a title.').max(500),
  result: z.string().trim().max(2000).default(''),
});
const tasksSchema = z
  .array(taskSchema)
  .min(2, 'A plan needs at least 2 tasks.')
  .max(5, 'A plan can have at most 5 tasks.');

const createBody = z.strictObject({ date: daySchema, tasks: tasksSchema });

workLogsRouter.post('/', async (req, res) => {
  const me = actor(req);
  if (!canRecordLogs(me)) throw forbidden('Only team members can record a work log.');
  const { date, tasks } = createBody.parse(req.body);

  const today = dayIn(await getTimezone());
  if (date !== today && date !== addDays(today, -1)) {
    throw new ApiError(400, 'DATE_NOT_ALLOWED', 'A plan can be created only for today or yesterday.');
  }

  try {
    const plan = await db.workPlan.create({
      data: {
        userId: me.id,
        date: toDbDate(date),
        tasks: { create: tasks.map((task, position) => ({ ...task, position })) },
      },
      include: planInclude,
    });
    res.status(201).json(present(plan, me, today));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw conflict('PLAN_EXISTS', 'You already have a plan for this day.');
    }
    throw err;
  }
});

const updateBody = z.strictObject({ tasks: tasksSchema });

workLogsRouter.put('/:id', async (req, res) => {
  const me = actor(req);
  const id = param(req.params.id);
  const { tasks } = updateBody.parse(req.body);

  const today = dayIn(await getTimezone());
  const plan = await db.$transaction(async (tx) => {
    const existing = await tx.workPlan.findUnique({ where: { id } });
    if (!existing) throw notFound('Plan not found.');
    if (existing.userId !== me.id) throw forbidden('You can edit only your own plan.');
    if (!canRecordLogs(me)) throw forbidden('Only team members can record a work log.');
    if (!withinEditWindow(fromDbDate(existing.date), today)) {
      throw new ApiError(403, 'PLAN_LOCKED', 'This plan is read-only now.');
    }
    await tx.workTask.deleteMany({ where: { planId: id } });
    return tx.workPlan.update({
      where: { id },
      data: { tasks: { create: tasks.map((task, position) => ({ ...task, position })) } },
      include: planInclude,
    });
  });
  res.json(present(plan, me, today));
});
