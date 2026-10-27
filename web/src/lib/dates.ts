/**
 * All date and time rendering goes through this module (DESIGN.md §9, card
 * t_c0da9abe). The API returns ISO 8601 UTC strings; they are always rendered
 * in the user's own locale and timezone — never a hard-coded zone. This is the
 * only place `Intl` formatting may live.
 *
 * Copy rule (§9): relative under 7 days ("2 h ago"), absolute after
 * ("12 Aug 2026"), with the full timestamp available for a title/tooltip.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** §9: the relative window — "under 7 days" is strictly less than this. */
export const RELATIVE_WINDOW_MS = 7 * DAY_MS;

export interface DateFormatOptions {
  /** BCP 47 tag. Defaults to the user's locale. */
  locale?: string;
  /** Injectable clock, for deterministic tests and server rendering. */
  now?: Date;
}

/** Short label plus the full timestamp, for §9's title/tooltip rule. */
export interface TimestampDescription {
  label: string;
  title: string;
}

function parse(iso: string): Date | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "12 Aug 2026" in the user's locale and zone. */
export function formatAbsoluteDate(
  iso: string,
  options: DateFormatOptions = {}
): string {
  const date = parse(iso);
  if (!date) return iso;
  return new Intl.DateTimeFormat(options.locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

/** Full timestamp for tooltips/titles, e.g. "12 Aug 2026, 14:26". */
export function formatFullTimestamp(
  iso: string,
  options: DateFormatOptions = {}
): string {
  const date = parse(iso);
  if (!date) return iso;
  return new Intl.DateTimeFormat(options.locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/**
 * "just now" / "10 min ago" / "2 h ago" / "3 d ago". Dates outside the §9
 * window — and future dates, which have no agreed relative copy yet — fall
 * back to the absolute form so the output is never wrong.
 */
export function formatRelativeTime(
  iso: string,
  options: DateFormatOptions = {}
): string {
  const date = parse(iso);
  if (!date) return iso;

  const now = options.now ?? new Date();
  const elapsed = now.getTime() - date.getTime();

  if (elapsed < 0 || elapsed >= RELATIVE_WINDOW_MS) {
    return formatAbsoluteDate(iso, options);
  }
  if (elapsed < MINUTE_MS) return "just now";
  if (elapsed < HOUR_MS) {
    return `${Math.floor(elapsed / MINUTE_MS)} min ago`;
  }
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} h ago`;
  return `${Math.floor(elapsed / DAY_MS)} d ago`;
}

/** §9 default: relative under 7 days, absolute from 7 days on. */
export function formatDateTime(
  iso: string,
  options: DateFormatOptions = {}
): string {
  const date = parse(iso);
  if (!date) return iso;

  const now = options.now ?? new Date();
  const elapsed = now.getTime() - date.getTime();
  if (elapsed >= 0 && elapsed < RELATIVE_WINDOW_MS) {
    return formatRelativeTime(iso, options);
  }
  return formatAbsoluteDate(iso, options);
}

/** The §9 pair: the label to show plus the full timestamp for its title. */
export function describeTimestamp(
  iso: string,
  options: DateFormatOptions = {}
): TimestampDescription {
  return {
    label: formatDateTime(iso, options),
    title: formatFullTimestamp(iso, options),
  };
}

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * True for a real calendar date in `YYYY-MM-DD` form (2026-02-30 is not).
 * The form dialogs use this to gate a date input before it reaches the API.
 */
export function isDateOnly(value: string): boolean {
  const match = DATE_ONLY_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * A calendar date (`YYYY-MM-DD`) rendered in the user's locale, e.g.
 * "14 Nov 2026". Date-only values carry no instant, so parsing them with
 * `new Date("2026-11-14")` would treat them as UTC midnight and print 13 Nov
 * in negative-offset zones. This rebuilds the date from its parts in the local
 * zone instead, so the printed day always matches the value the API sent.
 * Anything that is not a real `YYYY-MM-DD` day (bad shape, or a rollover like
 * `2026-02-30`) is returned unchanged rather than guessed at.
 */
export function formatDateOnly(
  ymd: string,
  options: DateFormatOptions = {}
): string {
  const match = DATE_ONLY_RE.exec(ymd);
  if (!match) return ymd;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  // JS normalises out-of-range parts (2026-02-30 → 2 Mar); reject those.
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return ymd;
  }
  return new Intl.DateTimeFormat(options.locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

/**
 * Compact calendar date for chart axes, e.g. "14 Nov". Same date-only rebuild
 * as `formatDateOnly` (no UTC-midnight shift); a malformed value is returned
 * unchanged rather than guessed at.
 */
export function formatDayMonth(
  ymd: string,
  options: DateFormatOptions = {}
): string {
  const match = DATE_ONLY_RE.exec(ymd);
  if (!match) return ymd;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return ymd;
  }
  return new Intl.DateTimeFormat(options.locale, {
    day: "numeric",
    month: "short",
  }).format(date);
}

/** A whole number of calendar days between two local dates, ignoring clock time. */
function calendarDayDiff(target: Date, from: Date): number {
  const t = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
  const f = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  return Math.round((t - f) / DAY_MS);
}

/**
 * The milestone countdown (DESIGN §4.5, PRD decision 11): "12 days left",
 * "Due today", "3 days late". It compares calendar days in the user's zone, so
 * a plain `YYYY-MM-DD` never shifts by a timezone. Returns `null` for a missing
 * or malformed date — a milestone without a due date shows no countdown.
 */
export function formatDaysLeft(
  ymd: string | null | undefined,
  options: DateFormatOptions = {}
): string | null {
  if (!ymd || !isDateOnly(ymd)) return null;
  const match = DATE_ONLY_RE.exec(ymd);
  if (!match) return null;
  const due = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const now = options.now ?? new Date();
  const days = calendarDayDiff(due, now);
  if (days === 0) return "Due today";
  if (days > 0) return days === 1 ? "1 day left" : `${days} days left`;
  const late = Math.abs(days);
  return late === 1 ? "1 day late" : `${late} days late`;
}
