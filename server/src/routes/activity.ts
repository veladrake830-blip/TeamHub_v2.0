import { Router } from 'express';
import { z } from 'zod';
import { db, Prisma } from '../db.ts';
import { avatarUrl } from '../lib/avatars.ts';
import { addDays, dayIn, daySchema, fromDbDate, toDbDate, withinEditWindow } from '../lib/dates.ts';
import { ApiError, badRequest, forbidden, notFound } from '../lib/errors.ts';
import { getTimezone } from '../lib/organization.ts';
import { canEditOwnLog, canRecordLogs, type Actor } from '../lib/policy.ts';
import { idSchema, pageSchema, param } from '../lib/schemas.ts';
import { actor, requireAuth } from '../middleware/auth.ts';

export const activityRouter = Router();
activityRouter.use(requireAuth);

const MAX_RANGE_DAYS = 92;

const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a time as HH:MM.')
  .transform((value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3)));

const toTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const entryInclude = {
  user: { select: { id: true, name: true, avatarPath: true, status: true } },
} satisfies Prisma.ActivityEntryInclude;

type EntryRow = Prisma.ActivityEntryGetPayload<{ include: typeof entryInclude }>;

function present(entry: EntryRow, me: Actor, today: string) {
  const date = fromDbDate(entry.date);
  return {
    id: entry.id,
    date,
    start: toTime(entry.startMinute),
    end: toTime(entry.endMinute),
    minutes: entry.endMinute - entry.startMinute,
    category: entry.category,
    note: entry.note,
    source: entry.source,
    user: {
      id: entry.user.id,
      name: entry.user.name,
      avatarUrl: avatarUrl(entry.user.avatarPath),
      deactivated: entry.user.status === 'DEACTIVATED',
    },
    canEdit: canEditOwnLog(me, entry.userId, withinEditWindow(date, today)),
  };
}

const listQuery = pageSchema.omit({ q: true }).extend({
  date: daySchema.optional(),
  userId: idSchema.optional(),
  teamId: idSchema.optional(),
});

// Every logged-in user can read this data, including the Admin and users without a team.
activityRouter.get('/entries', async (req, res) => {
  const me = actor(req);
  const { date, userId, teamId, page, pageSize } = listQuery.parse(req.query);
  const timezone = await getTimezone();
  const today = dayIn(timezone);
  const day = date ?? (userId ? undefined : today);

  const where: Prisma.ActivityEntryWhereInput = {
    ...(day ? { date: toDbDate(day) } : {}),
    ...(userId ? { userId } : {}),
    ...(teamId ? { user: { memberships: { some: { teamId } } } } : {}),
  };
  const [entries, total] = await Promise.all([
    db.activityEntry.findMany({
      where,
      include: entryInclude,
      orderBy: [{ date: 'desc' }, { user: { name: 'asc' } }, { userId: 'asc' }, { startMinute: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.activityEntry.count({ where }),
  ]);
  res.json({
    total,
    today,
    timezone,
    canRecord: canRecordLogs(me),
    items: entries.map((entry) => present(entry, me, today)),
  });
});

const entryFields = {
  start: timeSchema,
  end: timeSchema,
  category: z.string().trim().min(1, 'Enter a category.').max(60),
  note: z.string().trim().max(500).default(''),
};

/** An entry stays within one day. Time past midnight goes in a second entry. */
function checkTimes(start: number, end: number) {
  if (end <= start) throw badRequest('The end time must be after the start time.');
}

const createBody = z.strictObject({ date: daySchema, ...entryFields });

activityRouter.post('/entries', async (req, res) => {
  const me = actor(req);
  if (!canRecordLogs(me)) throw forbidden('Only team members can record activity time.');
  const { date, start, end, category, note } = createBody.parse(req.body);
  checkTimes(start, end);

  const today = dayIn(await getTimezone());
  if (!withinEditWindow(date, today)) {
    throw new ApiError(400, 'DATE_NOT_ALLOWED', 'Time can be recorded only for today or yesterday.');
  }
  const entry = await db.activityEntry.create({
    data: { userId: me.id, date: toDbDate(date), startMinute: start, endMinute: end, category, note },
    include: entryInclude,
  });
  res.status(201).json(present(entry, me, today));
});

async function findEditable(me: Actor, id: string) {
  const entry = await db.activityEntry.findUnique({ where: { id } });
  if (!entry) throw notFound('Entry not found.');
  if (entry.userId !== me.id) throw forbidden('You can change only your own entries.');
  if (!canRecordLogs(me)) throw forbidden('Only team members can record activity time.');
  const today = dayIn(await getTimezone());
  if (!withinEditWindow(fromDbDate(entry.date), today)) {
    throw new ApiError(403, 'ENTRY_LOCKED', 'This entry is read-only now.');
  }
  return { today };
}

const updateBody = z.strictObject(entryFields);

activityRouter.put('/entries/:id', async (req, res) => {
  const me = actor(req);
  const id = param(req.params.id);
  const { start, end, category, note } = updateBody.parse(req.body);
  checkTimes(start, end);
  const { today } = await findEditable(me, id);
  const entry = await db.activityEntry.update({
    where: { id },
    data: { startMinute: start, endMinute: end, category, note },
    include: entryInclude,
  });
  res.json(present(entry, me, today));
});

activityRouter.delete('/entries/:id', async (req, res) => {
  const me = actor(req);
  const id = param(req.params.id);
  await findEditable(me, id);
  await db.activityEntry.delete({ where: { id } });
  res.status(204).end();
});

const dashboardQuery = z.object({
  from: daySchema.optional(),
  to: daySchema.optional(),
  teamId: idSchema.optional(),
});

/** Adds minutes to a group whose name ignores case, keeping the first spelling seen. */
function addCategory(groups: Map<string, { category: string; minutes: number }>, category: string, minutes: number) {
  const key = category.toLowerCase();
  const group = groups.get(key) ?? { category, minutes: 0 };
  group.minutes += minutes;
  groups.set(key, group);
}

activityRouter.get('/dashboard', async (req, res) => {
  const { from: fromParam, to: toParam, teamId } = dashboardQuery.parse(req.query);
  const timezone = await getTimezone();
  const today = dayIn(timezone);
  const to = toParam ?? today;
  const from = fromParam ?? addDays(to, -6);
  if (from > to) throw badRequest('The start of the range must not be after its end.');

  const days: string[] = [];
  for (let day = from; day <= to && days.length <= MAX_RANGE_DAYS; day = addDays(day, 1)) days.push(day);
  if (days.length > MAX_RANGE_DAYS) throw badRequest(`Choose a range of at most ${MAX_RANGE_DAYS} days.`);

  const entries = await db.activityEntry.findMany({
    where: {
      date: { gte: toDbDate(from), lte: toDbDate(to) },
      ...(teamId ? { user: { memberships: { some: { teamId } } } } : {}),
    },
    select: {
      date: true,
      startMinute: true,
      endMinute: true,
      category: true,
      user: { select: { id: true, name: true, avatarPath: true } },
    },
  });

  const byDay = new Map(days.map((day) => [day, 0]));
  const categories = new Map<string, { category: string; minutes: number }>();
  const people = new Map<string, { id: string; name: string; avatarUrl: string | null; minutes: number; days: Set<string> }>();
  let totalMinutes = 0;

  for (const entry of entries) {
    const minutes = entry.endMinute - entry.startMinute;
    const day = fromDbDate(entry.date);
    totalMinutes += minutes;
    byDay.set(day, (byDay.get(day) ?? 0) + minutes);
    addCategory(categories, entry.category, minutes);
    const person = people.get(entry.user.id) ?? {
      id: entry.user.id,
      name: entry.user.name,
      avatarUrl: avatarUrl(entry.user.avatarPath),
      minutes: 0,
      days: new Set<string>(),
    };
    person.minutes += minutes;
    person.days.add(day);
    people.set(entry.user.id, person);
  }

  res.json({
    from,
    to,
    today,
    timezone,
    totalMinutes,
    entryCount: entries.length,
    peopleCount: people.size,
    byDay: [...byDay].map(([date, minutes]) => ({ date, minutes })),
    byCategory: [...categories.values()].sort((a, b) => b.minutes - a.minutes),
    byPerson: [...people.values()]
      .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name))
      .map(({ days: active, ...person }) => ({ ...person, activeDays: active.size })),
  });
});
