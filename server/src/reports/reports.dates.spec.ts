import { shiftDate, trendWindow, utcDateString } from './reports.dates';

/**
 * Day arithmetic for docs/api-project-overview.md § Fields: the window is
 * inclusive UTC calendar days, so a DST change or the host's timezone must never
 * change how many buckets a request returns.
 */
describe('trend dates', () => {
  it('reads the UTC date of an instant, not the host date', () => {
    expect(utcDateString(new Date('2026-10-27T23:30:00-05:00'))).toBe('2026-10-28');
    expect(utcDateString(new Date('2026-10-28T00:00:00Z'))).toBe('2026-10-28');
    expect(utcDateString(new Date('2026-10-28T23:59:59.999Z'))).toBe('2026-10-28');
  });

  it('shifts days across month, year and leap-day boundaries', () => {
    expect(shiftDate('2026-11-01', -1)).toBe('2026-10-31');
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDate('2028-03-01', -1)).toBe('2028-02-29');
    expect(shiftDate('2027-03-01', -1)).toBe('2027-02-28');
  });

  it('builds an inclusive window ending on the current UTC date', () => {
    const now = new Date('2026-10-28T10:00:00Z');
    expect(trendWindow(14, now)).toEqual({ from: '2026-10-15', to: '2026-10-28', days: 14 });
    expect(trendWindow(1, now)).toEqual({ from: '2026-10-28', to: '2026-10-28', days: 1 });
    expect(trendWindow(7, now)).toEqual({ from: '2026-10-22', to: '2026-10-28', days: 7 });
    expect(trendWindow(30, now)).toEqual({ from: '2026-09-29', to: '2026-10-28', days: 30 });
    expect(trendWindow(90, now)).toEqual({ from: '2026-07-31', to: '2026-10-28', days: 90 });
  });

  it('counts the last day by the UTC date even late at night locally', () => {
    const justAfterMidnightUtc = new Date('2026-10-29T00:05:00Z');
    expect(trendWindow(7, justAfterMidnightUtc)).toEqual({
      from: '2026-10-23',
      to: '2026-10-29',
      days: 7,
    });
  });
});