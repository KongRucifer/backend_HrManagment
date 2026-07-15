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
 * Converts a date string into a Date at UTC midnight, suitable for Prisma
 * `@db.Date` columns (the time part is ignored by the DB).
 *
 * Accepts BOTH "YYYY-MM-DD" and a full ISO timestamp. That matters because
 * @IsDateString() lets both shapes through, and clients round-trip the ISO
 * form the API handed them ("1998-05-20T00:00:00.000Z"). Naively appending the
 * time to that produced "...000ZT00:00:00.000Z" -> Invalid Date -> a 500.
 *
 * Slicing the date part (rather than parsing the instant and re-formatting)
 * keeps the calendar day intact regardless of server timezone.
 */
export function toDateOnly(dateStr: string): Date {
  return new Date(`${dateStr.slice(0, 10)}T00:00:00.000Z`);
}

/** First and last calendar day of the Vientiane month containing `ref`. */
export function monthRange(ref: string = getWorkDate()): {
  from: string;
  to: string;
} {
  const [y, m] = ref.split('-').map(Number);
  // Day 0 of the next month === last day of this month.
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const prefix = ref.slice(0, 7);
  return { from: `${prefix}-01`, to: `${prefix}-${String(last).padStart(2, '0')}` };
}

/**
 * Expands an inclusive @db.Date range into the WORK days it covers, skipping
 * Saturday and Sunday. Returns UTC-midnight Dates, matching the key shape used
 * by attendances.employeeId_workDate. A weekend-only range returns [].
 *
 * There is no workdays config on WorkSchedule and no holiday table, so the
 * Sat/Sun mask is hardcoded.
 *
 * MUST use getUTC* — @db.Date values are UTC midnight. Using getDay() would
 * resolve to the previous calendar day on any server west of UTC, shifting the
 * weekend mask by one. That bug cannot reproduce on a UTC+7 dev box.
 */
export function expandWorkDays(start: Date, end: Date): Date[] {
  const DAY = 86_400_000;
  const out: Date[] = [];
  let cur = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const last = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  while (cur <= last) {
    const d = new Date(cur);
    const dow = d.getUTCDay(); // 0 = Sunday, 6 = Saturday
    if (dow !== 0 && dow !== 6) out.push(d);
    cur += DAY; // epoch-millis arithmetic is DST-proof
  }
  return out;
}

// ---------------------------------------------------------------------------
// Request duration helpers (leave / emergency)
// ---------------------------------------------------------------------------

/** "HH:mm" or "HH:mm:ss" -> minutes since midnight. */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Inclusive day count between two @db.Date values (both ends counted).
 * Same day -> 1, 14th..16th -> 3.
 */
export function countDays(start: Date, end: Date): number {
  const DAY = 86_400_000;
  const a = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const b = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  return Math.floor((b - a) / DAY) + 1;
}

/**
 * Working hours a request covers, counted PER DAY and clamped to the employee's
 * work schedule — hours outside the working window don't count.
 *
 *   schedule 09:00-17:30, request 08:00-17:00 over 3 days
 *   -> overlap per day = 09:00-17:00 = 8h  ->  8 x 3 = 24h
 *
 * Returns 0 when the requested window doesn't overlap the working window at all
 * (callers treat that as "outside working hours").
 */
export function countWorkHours(
  startTime: string,
  endTime: string,
  days: number,
  schedule: { startTime: string; endTime: string } | null,
): number {
  const reqStart = timeToMinutes(startTime);
  const reqEnd = timeToMinutes(endTime);
  // No schedule -> fall back to the raw requested window.
  const winStart = schedule ? timeToMinutes(schedule.startTime) : reqStart;
  const winEnd = schedule ? timeToMinutes(schedule.endTime) : reqEnd;

  const overlap = Math.min(reqEnd, winEnd) - Math.max(reqStart, winStart);
  if (overlap <= 0) return 0;
  const perDay = overlap / 60;
  return Math.round(perDay * days * 100) / 100;
}
