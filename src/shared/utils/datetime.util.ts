/**
 * Helpers for working in the company timezone (Asia/Vientiane, GMT+7).
 * Timestamps are stored as UTC instants; only the "work date" and the
 * late-threshold need timezone-aware handling.
 */
export const APP_TIMEZONE = 'Asia/Vientiane';
export const APP_TZ_OFFSET = '+07:00';

/** Returns the local (Vientiane) calendar date as "YYYY-MM-DD". */
export function getWorkDate(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return now.toLocaleDateString('en-CA', { timeZone: APP_TIMEZONE });
}

/**
 * Builds the UTC instant for a given "HH:mm" / "HH:mm:ss" time on a
 * Vientiane work date. Used to decide whether a check-in is late.
 */
export function timeOnDateToInstant(workDate: string, time: string): Date {
  const normalized = time.length === 5 ? `${time}:00` : time;
  return new Date(`${workDate}T${normalized}${APP_TZ_OFFSET}`);
}

/** Whole-hour difference (2 decimals) between two instants. */
export function diffHours(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.round((ms / 3_600_000) * 100) / 100;
}

/**
 * Converts a "YYYY-MM-DD" string into a Date at UTC midnight, suitable for
 * Prisma `@db.Date` columns (the time part is ignored by the DB).
 */
export function toDateOnly(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}
