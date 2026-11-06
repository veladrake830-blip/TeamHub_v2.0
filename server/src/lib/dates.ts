import { z } from 'zod';

// Calendar days are handled as YYYY-MM-DD strings. "Today" depends on the organization
// timezone, so a day must never be derived from a server-local Date.

export const isValidTimezone = (timezone: string) => {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
};

/** The calendar day at `now` in the given timezone. */
export function dayIn(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Editable until the end of the day after `day`. Days compare correctly as strings. */
export const withinEditWindow = (day: string, today: string) => day >= addDays(today, -1) && day <= today;

/** Prisma's @db.Date columns use UTC midnight. */
export const toDbDate = (day: string) => new Date(`${day}T00:00:00Z`);
export const fromDbDate = (date: Date) => date.toISOString().slice(0, 10);

export const daySchema = z.iso.date('Enter a valid date.');
