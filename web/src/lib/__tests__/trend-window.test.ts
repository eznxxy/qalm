import {
  DEFAULT_TREND_DAYS,
  TREND_WINDOWS,
  formatPassRate,
  parseTrendDays,
  trendEmptyCopy,
  trendTitle,
  trendWindowLabel,
} from "@/lib/trend-window";

/**
 * Trend window helpers (docs/PRD-project-overview.md decision 6). The screen
 * offers exactly four presets; the URL is the only source of truth, so an
 * unknown or missing value must fall back silently rather than request a
 * window the UI cannot show as pressed.
 */

describe("TREND_WINDOWS", () => {
  it("offers exactly 1, 7, 14 and 30 days", () => {
    expect([...TREND_WINDOWS]).toEqual([1, 7, 14, 30]);
    expect(DEFAULT_TREND_DAYS).toBe(14);
  });
});

describe("parseTrendDays", () => {
  it.each(["1", "7", "14", "30"])("keeps the preset %s", (value) => {
    expect(parseTrendDays(value)).toBe(Number(value));
  });

  it.each([
    ["missing", null],
    ["undefined", undefined],
    ["empty", ""],
    ["out of range", "99"],
    ["zero", "0"],
    ["not a number", "abc"],
    ["a float", "7.5"],
  ])("falls back to 14 when the value is %s", (_label, value) => {
    expect(parseTrendDays(value)).toBe(14);
  });
});

describe("trendTitle", () => {
  it("names the window, and says today for a single day", () => {
    expect(trendTitle(1)).toBe("Results recorded, today");
    expect(trendTitle(7)).toBe("Results recorded, last 7 days");
    expect(trendTitle(14)).toBe("Results recorded, last 14 days");
    expect(trendTitle(30)).toBe("Results recorded, last 30 days");
  });
});

describe("trendEmptyCopy", () => {
  it("matches the resolved window", () => {
    expect(trendEmptyCopy(1)).toBe("No results recorded today.");
    expect(trendEmptyCopy(7)).toBe("No results recorded in the last 7 days.");
    expect(trendEmptyCopy(30)).toBe("No results recorded in the last 30 days.");
  });
});

describe("formatPassRate", () => {
  it("prints the API's one-decimal rate with a percent sign", () => {
    expect(formatPassRate(81.6)).toBe("81.6%");
    expect(formatPassRate(100)).toBe("100%");
    expect(formatPassRate(0)).toBe("0%");
  });

  it("prints an em dash for a zero denominator, never 0%", () => {
    expect(formatPassRate(null)).toBe("—");
  });
});

describe("trendWindowLabel", () => {
  it("gives the range buttons a full accessible name", () => {
    expect(trendWindowLabel(1)).toBe("Last 1 day");
    expect(trendWindowLabel(7)).toBe("Last 7 days");
    expect(trendWindowLabel(30)).toBe("Last 30 days");
  });
});