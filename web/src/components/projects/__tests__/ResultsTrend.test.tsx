import { render, screen } from "@testing-library/react";
import type { ProjectTrend, TrendBucket } from "@/lib/api-types";
import { PLOT_WIDTH, barWidthFor } from "@/lib/chart-scale";
import { ResultsTrend } from "../ResultsTrend";

/**
 * The overview's trend card now takes its plot geometry from `chart-scale`,
 * like the reports failures chart. These assertions pin the numbers the card
 * draws, so the two charts cannot silently drift apart.
 */

function bucket(date: string, passed: number, failed: number): TrendBucket {
  const total = passed + failed;
  return {
    date,
    status_counts: { passed, failed, blocked: 0, retest: 0, skipped: 0 },
    total,
    pass_rate: total === 0 ? null : Math.round((passed / total) * 1000) / 10,
  };
}

const TREND: ProjectTrend = {
  project_id: "p-1",
  from: "2026-09-29",
  to: "2026-10-28",
  days: 30,
  buckets: Array.from({ length: 30 }, (_, index) =>
    bucket(`2026-10-${String(index + 1).padStart(2, "0")}`, 2, 1)
  ),
  totals: {
    status_counts: { passed: 60, failed: 30, blocked: 0, retest: 0, skipped: 0 },
    total: 90,
    pass_rate: 66.7,
  },
};

let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({ data: TREND }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )
  );
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe("ResultsTrend plot geometry", () => {
  it("gives every day a slot and every column the shared width", async () => {
    const { container } = render(
      <ResultsTrend projectId="p-1" days={30} onDaysChange={jest.fn()} />
    );

    await screen.findByRole("img", {
      name: /Results recorded in the last 30 days/,
    });

    const slots = container.querySelectorAll(".ov-trend-col-bg");
    expect(slots).toHaveLength(30);
    for (const slot of Array.from(slots)) {
      expect(Number(slot.getAttribute("width"))).toBeCloseTo(PLOT_WIDTH / 30);
    }

    // Bars come from barWidthFor, not from a local formula. The top segment of
    // each column is a rounded path (so it has no width attribute): one per
    // column, which pins that both charts round the same segment.
    const bars = container.querySelectorAll(
      ".ov-trend-col > rect:not(.ov-trend-col-bg)"
    );
    expect(bars).toHaveLength(30);
    for (const bar of Array.from(bars)) {
      expect(Number(bar.getAttribute("width"))).toBeCloseTo(barWidthFor(30));
    }
    expect(container.querySelectorAll(".ov-trend-col > path")).toHaveLength(30);
  });
});
