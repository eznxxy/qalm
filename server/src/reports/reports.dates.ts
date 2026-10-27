/**
 * Day arithmetic for the trend, docs/api-project-overview.md § Fields. Dates are
 * plain `YYYY-MM-DD` strings in UTC; a bucket is never derived from the
 * process's local timezone.
 */

/** The UTC calendar date of an instant, e.g. `2026-10-28`. */
export function utcDateString(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

/**
 * Shifts a plain date by whole days inside UTC. `Date.UTC` keeps a DST change
 * from making a "day" 23 or 25 hours long, which is why this does not use local
 * date parts.
 */
export function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * 86_400_000);
  return utcDateString(shifted);
}

export interface TrendWindow {
  from: string;
  to: string;
  days: number;
}

/** The inclusive window of `days` UTC days ending on `now`'s UTC date. */
export function trendWindow(days: number, now: Date): TrendWindow {
  const to = utcDateString(now);
  return { from: shiftDate(to, -(days - 1)), to, days };
}