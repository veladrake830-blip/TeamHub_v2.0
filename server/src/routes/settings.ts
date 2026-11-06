import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.ts';
import { audit, clientIp } from '../lib/audit.ts';
import { dayIn, isValidTimezone } from '../lib/dates.ts';
import { forbidden } from '../lib/errors.ts';
import { getTimezone } from '../lib/organization.ts';
import { canManageOrganization } from '../lib/policy.ts';
import { actor, requireAuth } from '../middleware/auth.ts';

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

settingsRouter.get('/organization', async (_req, res) => {
  const timezone = await getTimezone();
  res.json({ timezone, today: dayIn(timezone) });
});

const organizationBody = z.strictObject({
  timezone: z.string().trim().min(1).max(100).refine(isValidTimezone, 'Choose a valid timezone.'),
});

settingsRouter.put('/organization', async (req, res) => {
  const me = actor(req);
  if (!canManageOrganization(me)) throw forbidden();
  const { timezone } = organizationBody.parse(req.body);
  await db.$transaction(async (tx) => {
    const current = await tx.organizationSettings.findUniqueOrThrow({ where: { id: 1 } });
    if (current.timezone === timezone) return;
    await tx.organizationSettings.update({ where: { id: 1 }, data: { timezone } });
    await audit(tx, {
      actor: me,
      action: 'TIMEZONE_CHANGED',
      details: { from: current.timezone, to: timezone },
      ip: clientIp(req),
    });
  });
  res.json({ timezone, today: dayIn(timezone) });
});
