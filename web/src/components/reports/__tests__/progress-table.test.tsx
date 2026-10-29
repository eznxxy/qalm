import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ProgressRun, ReportProgress } from "@/lib/api-types";
import { ProgressTable, activityText } from "../ProgressTable";

const NOW = new Date("2026-10-28T12:00:00Z");

const run = (overrides: Partial<ProgressRun> = {}): ProgressRun => ({
  id: "r-1",
  name: "Release 2.4 smoke",
  status: "open",
  plan_id: null,
  plan_name: null,
  milestone_id: null,
  milestone_name: null,
  start_date: null,
  due_date: null,
  counts: {
    total: 50,
    passed: 31,
    failed: 4,
    blocked: 2,
    retest: 0,
    skipped: 5,
    untested: 8,
    percent_complete: 84,
  },
  pass_rate: 83.8,
  results_in_window: 38,
  last_result_at: "2026-10-28T10:00:00Z",
  ...overrides,
});

const progress = (data: ProgressRun[], total = data.length): ReportProgress => ({
  data,
  meta: {
    page: 1,
    limit: 25,
    total,
    total_pages: Math.max(1, Math.ceil(total / 25)),
  },
  items: { total: 50, with_results: 42, untested: 8, percent_complete: 84 },
});

const renderTable = (
  overrides: Partial<Parameters<typeof ProgressTable>[0]> = {}
) =>
  render(
    <ProgressTable
      projectId="p-1"
      progress={progress([run()])}
      page={1}
      onPageChange={jest.fn()}
      filtered={false}
      onClearFilters={jest.fn()}
      {...overrides}
    />
  );

describe("activityText", () => {
  it("counts events in the window and names the last activity", () => {
    expect(
      activityText(
        run({ results_in_window: 38, last_result_at: "2026-10-28T10:00:00Z" }),
        NOW
      )
    ).toBe("38 in window · 2 h ago");
  });

  it("distinguishes a stale run from one with no results at all", () => {
    expect(activityText(run({ results_in_window: 0 }))).toBe(
      "No results in window"
    );
    expect(
      activityText(run({ results_in_window: 0, last_result_at: null }))
    ).toBe("No results yet");
  });
});

describe("ProgressTable", () => {
  it("links each run to its detail with the project scope", () => {
    renderTable();
    expect(screen.getByRole("link", { name: "Release 2.4 smoke" })).toHaveAttribute(
      "href",
      "/runs/r-1?project=p-1"
    );
  });

  it("shows current progress, the bar and the per-run rate", () => {
    renderTable();
    expect(screen.getByText("42 of 50")).toBeInTheDocument();
    expect(screen.getByText("84% complete")).toBeInTheDocument();
    expect(screen.getByText("83.8%")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /Release 2.4 smoke: 31 passed/ })
    ).toBeInTheDocument();
  });

  it("prints an em dash for every missing value", () => {
    renderTable({ progress: progress([run({ pass_rate: null })]) });
    const row = screen.getByText("Release 2.4 smoke").closest("tr") as HTMLElement;
    expect(within(row).getAllByText("—")).toHaveLength(4);
    expect(within(row).queryByText("-")).toBeNull();
  });

  it("says the project has no runs and points at Test runs", () => {
    renderTable({ progress: progress([]) });
    expect(screen.getByText("No runs in this project yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Test runs" })).toHaveAttribute(
      "href",
      "/runs?project=p-1"
    );
  });

  it("offers Clear filters when the filters match nothing", () => {
    const onClearFilters = jest.fn();
    renderTable({ progress: progress([]), filtered: true, onClearFilters });
    expect(screen.getByText("No runs match these filters.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onClearFilters).toHaveBeenCalled();
  });

  it("offers a way back from a page past the end, keeping the real total", () => {
    const onPageChange = jest.fn();
    renderTable({
      progress: {
        ...progress([], 60),
        meta: { page: 5, limit: 25, total: 60, total_pages: 3 },
      },
      page: 5,
      onPageChange,
    });
    expect(screen.getByText("No runs on this page.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go to page 1" }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it("counts matching runs in the singular and the plural", () => {
    const single = renderTable();
    expect(screen.getByText("1 matching run")).toBeInTheDocument();
    single.unmount();

    renderTable({
      progress: progress([run(), run({ id: "r-2", name: "Second run" })]),
    });
    expect(screen.getByText("2 matching runs")).toBeInTheDocument();
  });

  it("captions the table as paged, not as every run", () => {
    renderTable();
    // The table holds one page; the tile's rollup covers every filtered run.
    expect(
      screen.getByText("Progress of runs matching the report filters")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Progress of every run matching the report filters")
    ).not.toBeInTheDocument();
  });

  it("pages with the real meta and disables the ends", () => {
    renderTable({ progress: progress([run()], 60), page: 1 });
    expect(screen.getByText("Page 1 of 3 (60 runs)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });
});