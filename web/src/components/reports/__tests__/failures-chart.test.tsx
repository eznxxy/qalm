import { fireEvent, render, screen, within } from "@testing-library/react";
import { FailuresChart } from "../FailuresChart";
import type { TrendBucket } from "@/lib/api-types";

const bucket = (date: string, failed = 0, blocked = 0, retest = 0): TrendBucket => ({
  date,
  status_counts: { passed: 99, failed, blocked, retest, skipped: 7 },
  total: failed + blocked + retest + 106,
  pass_rate: 90,
});

describe("FailuresChart", () => {
  const renderChart = (buckets: TrendBucket[], days = 1, loading = false) =>
    render(
      <FailuresChart projectId="p-1" buckets={buckets} days={days} loading={loading} />
    );

  it("names the window in the card title", () => {
    renderChart([bucket("2026-10-28", 2, 1, 1)], 30);
    expect(
      screen.getByRole("heading", { name: "Failures over time, last 30 days" })
    ).toBeInTheDocument();
  });

  it("names only Failed, Blocked and Retest, never Passed or Skipped", () => {
    renderChart([bucket("2026-10-28", 2, 1, 1)]);
    const legend = screen.getByRole("list");
    expect(within(legend).getByText("Failed")).toBeInTheDocument();
    expect(within(legend).getByText("Blocked")).toBeInTheDocument();
    expect(within(legend).getByText("Retest")).toBeInTheDocument();
    expect(within(legend).queryByText("Passed")).toBeNull();
    expect(within(legend).queryByText("Skipped")).toBeNull();
    expect(screen.getByText("UTC days")).toBeInTheDocument();
  });

  it("summarises the window for assistive tech", () => {
    renderChart([bucket("2026-10-28", 2, 1, 1)]);
    expect(screen.getByRole("img", { name: /Failures today: 2 failed, 1 blocked, 1 retested/ })).toBeInTheDocument();
  });

  it("offers a per-day table with the three counts", () => {
    renderChart([bucket("2026-10-28", 2, 1, 1)]);
    fireEvent.click(screen.getByRole("button", { name: "View as table" }));
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Failed" })).toBeInTheDocument();
    expect(within(table).getByRole("rowheader", { name: /Oct 28|28 Oct/ })).toBeInTheDocument();
    expect(within(table).getByRole("cell", { name: "4" })).toBeInTheDocument();
  });

  it("says results were not failures when the window has results", () => {
    renderChart([bucket("2026-10-28")], 7);
    expect(
      screen.getByText("No failed, blocked or retested results in the last 7 days.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Go to Test runs" })).toBeNull();
  });

  it("offers Test runs when the window has no results at all", () => {
    renderChart(
      [
        {
          date: "2026-10-28",
          status_counts: { passed: 0, failed: 0, blocked: 0, retest: 0, skipped: 0 },
          total: 0,
          pass_rate: null,
        },
      ],
      30
    );
    expect(
      screen.getByText("No results recorded in the last 30 days.")
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Test runs" }))
      .toHaveAttribute("href", "/runs?project=p-1");
  });

  it("marks the plot busy while a new window loads", () => {
    const { container } = renderChart([bucket("2026-10-28", 1)], 1, true);
    expect(container.querySelector(".rep-plot")).toHaveAttribute("aria-busy", "true");
  });
});