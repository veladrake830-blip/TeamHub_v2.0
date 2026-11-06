import { db } from '../db.ts';
import { dayIn } from './dates.ts';

export async function getTimezone() {
  const settings = await db.organizationSettings.findUniqueOrThrow({ where: { id: 1 } });
  return settings.timezone;
}

export async function getToday() {
  return dayIn(await getTimezone());
}
