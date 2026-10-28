import {
  describeTimestamp,
  formatAbsoluteDate,
  formatDateOnly,
  formatDateTime,
  formatDaysLeft,
  formatFullTimestamp,
  formatRelativeTime,
  RELATIVE_WINDOW_MS,
} from "@/lib/dates";

/**
 * DESIGN.md §9 (card t_c0da9abe): relative under 7 days, absolute after, in the
 * user's locale and zone — never a hard-coded UTC. The clock and locale are
 * injected so the copy is asserted exactly.
 */
const NOW = new Date("2026-10-25T12:00:00Z");
const LOCALE = "en-GB";

/** Builds an ISO timestamp that is `ms` older than NOW. */
function ago(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatRelativeTime", () => {
  it.each([
    [0, "just now"],
    [59_000, "just now"],
    [MINUTE, "1 min ago"],
    [10 * MINUTE, "10 min ago"],
    [59 * MINUTE, "59 min ago"],
    [HOUR, "1 h ago"],
    [2 * HOUR + 30 * MINUTE, "2 h ago"],
    [DAY, "1 d ago"],
    [6 * DAY, "6 d ago"],
  ])("%i ms ago reads %j", (elapsed, expected) => {
    expect(
      formatRelativeTime(ago(elapsed), { now: NOW, locale: LOCALE })
    ).toBe(expected);
  });

  it("flips to the absolute date at the 7-day boundary", () => {
    expect(
      formatRelativeTime(ago(RELATIVE_WINDOW_MS - 1), { now: NOW, locale: LOCALE })
    ).toBe("6 d ago");
    expect(
      formatRelativeTime(ago(RELATIVE_WINDOW_MS), { now: NOW, locale: LOCALE })
    ).toBe("18 Oct 2026");
  });

  it("has no relative copy for future dates — falls back to absolute", () => {
    const future = new Date(NOW.getTime() + 2 * HOUR).toISOString();
    expect(formatRelativeTime(future, { now: NOW, locale: LOCALE })).toBe(
      "25 Oct 2026"
    );
  });
});

describe("formatDateTime", () => {
  it("stays relative inside the 7-day window", () => {
    expect(formatDateTime(ago(2 * HOUR), { now: NOW, locale: LOCALE })).toBe(
      "2 h ago"
    );
  });

  it("switches to the absolute date at 7 days", () => {
    expect(formatDateTime(ago(7 * DAY), { now: NOW, locale: LOCALE })).toBe(
      "18 Oct 2026"
    );
  });
});

describe("absolute forms", () => {
  it("formatAbsoluteDate renders a date with no time", () => {
    expect(formatAbsoluteDate("2026-08-12T04:26:00Z", { locale: LOCALE })).toBe(
      "12 Aug 2026"
    );
  });

  it("formatFullTimestamp carries the time for a tooltip", () => {
    expect(
      formatFullTimestamp("2026-08-12T04:26:00Z", { locale: LOCALE })
    ).toMatch(/^12 Aug 2026, \d{1,2}:\d{2}( [AP]M)?$/);
  });

  it("uses the user's zone, not UTC (the t_c0da9abe bug)", () => {
    // A UTC instant that is a different calendar day in most other zones than
    // it is in UTC alone: the rendered day must follow the local zone.
    const iso = "2026-08-12T23:30:00Z";
    const localDay = new Intl.DateTimeFormat(LOCALE, { day: "numeric" }).format(
      new Date(iso)
    );
    expect(formatAbsoluteDate(iso, { locale: LOCALE })).toContain(
      `${localDay} Aug 2026`
    );
  });
});

describe("describeTimestamp", () => {
  it("pairs the short label with the full timestamp for the title", () => {
    const { label, title } = describeTimestamp("2026-08-12T04:26:00Z", {
      now: NOW,
      locale: LOCALE,
    });
    expect(label).toBe("12 Aug 2026");
    expect(title).toMatch(/^12 Aug 2026, \d{1,2}:\d{2}( [AP]M)?$/);
    expect(title).not.toBe(label);
  });
});

describe("bad input", () => {
  it("returns the raw string instead of throwing", () => {
    const invalid = "not-a-date";
    expect(formatDateTime(invalid, { now: NOW, locale: LOCALE })).toBe(invalid);
    expect(formatRelativeTime(invalid, { now: NOW, locale: LOCALE })).toBe(invalid);
    expect(formatAbsoluteDate(invalid, { locale: LOCALE })).toBe(invalid);
    expect(formatFullTimestamp(invalid, { locale: LOCALE })).toBe(invalid);
  });
});

describe("formatDateOnly", () => {
  it("renders a plain YYYY-MM-DD day in the user's locale", () => {
    expect(formatDateOnly("2026-11-14", { locale: LOCALE })).toBe("14 Nov 2026");
    expect(formatDateOnly("2026-01-05", { locale: LOCALE })).toBe("5 Jan 2026");
  });

  it("never shifts the day (no UTC-midnight parse)", () => {
    // `new Date("2026-11-14")` is UTC midnight, which is still 13 Nov in
    // negative-offset zones. Matching against the default (system) locale must
    // still print the 14th everywhere.
    expect(formatDateOnly("2026-11-14")).toBe(
      new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(new Date(2026, 10, 14))
    );
  });

  it("returns the raw string for a bad shape", () => {
    expect(formatDateOnly("14/11/2026", { locale: LOCALE })).toBe("14/11/2026");
    expect(formatDateOnly("2026-11", { locale: LOCALE })).toBe("2026-11");
    expect(formatDateOnly("", { locale: LOCALE })).toBe("");
  });

  it("returns the raw string for a rollover date (2026-02-30)", () => {
    expect(formatDateOnly("2026-02-30", { locale: LOCALE })).toBe("2026-02-30");
    expect(formatDateOnly("2026-13-01", { locale: LOCALE })).toBe("2026-13-01");
  });
});

describe("formatDaysLeft", () => {
  // The countdown compares calendar days in the user's zone, so the clock is
  // built from local parts: 25 Oct 2026 is that day in every timezone.
  const TODAY = new Date(2026, 9, 25, 12, 0, 0);

  it.each([
    ["2026-10-25", "Due today"],
    ["2026-10-26", "1 day left"],
    ["2026-11-06", "12 days left"],
    ["2026-10-24", "1 day late"],
    ["2026-10-22", "3 days late"],
  ])("%s reads %j", (due, expected) => {
    expect(formatDaysLeft(due, { now: TODAY })).toBe(expected);
  });

  it("counts calendar days, not elapsed hours", () => {
    // 23:59 on the due date is still "Due today" even though it is under an
    // hour away from midnight.
    const lateEvening = new Date(2026, 9, 25, 23, 59);
    expect(formatDaysLeft("2026-10-25", { now: lateEvening })).toBe("Due today");
    expect(formatDaysLeft("2026-10-26", { now: lateEvening })).toBe(
      "1 day left"
    );
  });

  it("returns null for a missing or malformed date", () => {
    expect(formatDaysLeft(null, { now: TODAY })).toBeNull();
    expect(formatDaysLeft(undefined, { now: TODAY })).toBeNull();
    expect(formatDaysLeft("", { now: TODAY })).toBeNull();
    expect(formatDaysLeft("26/10/2026", { now: TODAY })).toBeNull();
    expect(formatDaysLeft("2026-02-30", { now: TODAY })).toBeNull();
  });
});
