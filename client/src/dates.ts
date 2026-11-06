// Days are plain YYYY-MM-DD strings from the server, in the organization timezone.
// They are handled in UTC here only so that the viewer's own timezone can't shift them.

export function shiftDay(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export const formatDay = (
  day: string,
  options: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' },
) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { ...options, timeZone: 'UTC' });

export function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
