/**
 * The project overview's trend window (docs/PRD-project-overview.md decision 6,
 * docs/DESIGN.md §4.8). The screen offers four presets; the endpoint accepts a
 * wider 1–90 range for the reports slice, but this UI never sends anything
 * else. The choice lives in the URL (`?days=30`) so a reload or a shared link
 * keeps it, and an unknown value falls back to 14 silently.
 */

export const TREND_WINDOWS = [1, 7, 14, 30] as const;

export type TrendWindow = (typeof TREND_WINDOWS)[number];

export const DEFAULT_TREND_DAYS: TrendWindow = 14;

/** The resolved window: only the four presets are ever requested. */
export function parseTrendDays(value: string | null | undefined): TrendWindow {
  const parsed = Number(value);
  return (TREND_WINDOWS as readonly number[]).includes(parsed)
    ? (parsed as TrendWindow)
    : DEFAULT_TREND_DAYS;
}

/** "Results recorded, last 14 days" / "Results recorded, today". */
export function trendTitle(days: TrendWindow): string {
  return days === 1
    ? "Results recorded, today"
    : `Results recorded, last ${days} days`;
}

/** "No results recorded in the last 14 days." / "No results recorded today." */
export function trendEmptyCopy(days: TrendWindow): string {
  return days === 1
    ? "No results recorded today."
    : `No results recorded in the last ${days} days.`;
}

/**
 * A pass rate as the card prints it: one decimal from the API, `—` when the
 * denominator was zero (never "0%", which would claim every result failed).
 */
export function formatPassRate(rate: number | null): string {
  return rate === null ? "—" : `${rate}%`;
}

/** "1 day" / "30 days" for the range buttons' accessible names. */
export function trendWindowLabel(days: TrendWindow): string {
  return days === 1 ? "Last 1 day" : `Last ${days} days`;
}