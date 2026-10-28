import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import type {
  Milestone,
  Plan,
  ProgressRun,
  Project,
  ReportSummary,
  TrendBucket,
  User,
} from "@/lib/api-types";

/**
 * The reports screen (card 6.9). Covers the behaviour the cards do not own:
 * one aggregate request per URL state, the URL writing the window and the
 * three filters, the tile copy (including the em dash) and the single
 * page-level error panel.
 */

const mockRouterState = {
  search: "project=p-1",
  replace: jest.fn(),
  push: jest.fn(),
};

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockRouterState.replace,
    push: mockRouterState.push,
    back: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => "/reports",
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(mockRouterState.search),
}));

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "u-1",
    email: "ada@example.com",
    name: "Ada Lovelace",
    role: "admin",
    is_active: true,
    must_change_password: false,
    created_at: "2026-10-07T12:00:00Z",
    updated_at: "2026-10-07T12:00:00Z",
    ...overrides,
  };
}

const PROJECT: Project = {
  id: "p-1",
  key: "PAY",
  name: "Payments",
  description: "Checkout and billing flows",
  status: "active",
  created_by: "u-1",
  created_at: "2026-10-07T12:00:00Z",
  updated_at: "2026-10-07T12:00:00Z",
};

const PLAN: Plan = {
  id: "pl-1",
  project_id: "p-1",
  name: "Release 2.4",
  description: null,
  due_date: "2026-11-14",
  run_count: 1,
  counts: {
    total: 4,
    passed: 2,
    failed: 1,
    blocked: 0,
    retest: 0,
    skipped: 0,
    untested: 1,
    percent_complete: 75,
  },
  created_by: "u-1",
  updated_by: "u-1",
  created_at: "2026-10-20T12:00:00Z",
  updated_at: "2026-10-20T12:00:00Z",
};

const MILESTONE: Milestone = {
  id: "m-1",
  project_id: "p-1",
  name: "Beta",
  description: null,
  due_date: "2026-11-21",
  status: "open",
  run_count: 1,
  counts: {
    total: 4,
    passed: 2,
    failed: 1,
    blocked: 0,
    retest: 0,
    skipped: 0,
    untested: 1,
    percent_complete: 75,
  },
  created_by: "u-1",
  updated_by: "u-1",
  created_at: "2026-10-20T12:00:00Z",
  updated_at: "2026-10-20T12:00:00Z",
};

/** One UTC day: the four statuses the brief derives the totals from. */
function bucket(
  date: string,
  passed: number,
  failed: number,
  blocked: number
): TrendBucket {
  const total = passed + failed + blocked;
  return {
    date,
    status_counts: { passed, failed, blocked, retest: 0, skipped: 0 },
    total,
    pass_rate: total === 0 ? null : Math.round((passed / total) * 1000) / 10,
  };
}

/** Mirrors the progress table's `run()` fixture (card 6.8). */
function progressRun(overrides: Partial<ProgressRun> = {}): ProgressRun {
  return {
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
  };
}

const summary = (overrides: Partial<ReportSummary> = {}): ReportSummary => ({
  project_id: "p-1",
  from: "2026-09-29",
  to: "2026-10-28",
  days: 30,
  filters: { plan_id: null, milestone_id: null, status: null },
  trend: {
    buckets: [bucket("2026-10-28", 2, 1, 1)],
    totals: {
      status_counts: {
        passed: 460,
        failed: 6,
        blocked: 2,
        retest: 2,
        skipped: 20,
      },
      total: 490,
      pass_rate: 97.9,
    },
  },
  progress: {
    data: [progressRun()],
    meta: { page: 1, limit: 25, total: 1, total_pages: 1 },
    items: { total: 50, with_results: 42, untested: 8, percent_complete: 84 },
  },
  ...overrides,
});

let fetchMock: jest.Mock;

interface ApiOptions {
  project?: Project;
  projects?: Project[];
  summary?: ReportSummary;
  /** Fail every summary request with a 4xx (the client does not auto-retry). */
  summaryError?: boolean;
  plans?: Plan[];
  milestones?: Milestone[];
  /** Fail the filter-option fetch; the report itself must still render. */
  optionsError?: boolean;
}

function mockApi({
  project = PROJECT,
  projects = [PROJECT],
  summary: report = summary(),
  summaryError = false,
  plans = [PLAN],
  milestones = [MILESTONE],
  optionsError = false,
}: ApiOptions = {}): void {
  const user = makeUser();
  fetchMock.mockImplementation(
    (url: string, init?: { method?: string; body?: string }) => {
      const target = String(url);
      const method = init?.method ?? "GET";

      if (target.includes("/auth/refresh")) {
        return Promise.resolve(
          jsonResponse(200, {
            data: {
              access_token: "tok-r",
              token_type: "Bearer",
              expires_in: 900,
            },
          })
        );
      }
      if (target.includes("/auth/me")) {
        return Promise.resolve(jsonResponse(200, { data: user }));
      }
      if (target.includes("/reports/summary")) {
        if (summaryError) {
          return Promise.resolve(
            jsonResponse(400, {
              error: {
                code: "VALIDATION_ERROR",
                message: "Something went wrong.",
              },
            })
          );
        }
        return Promise.resolve(jsonResponse(200, { data: report }));
      }
      if (/\/projects\/[\w-]+\/plans(\?|$)/.test(target) && method === "GET") {
        if (optionsError) {
          return Promise.resolve(
            jsonResponse(400, {
              error: { code: "VALIDATION_ERROR", message: "Nope." },
            })
          );
        }
        return Promise.resolve(
          jsonResponse(200, {
            data: plans,
            meta: { page: 1, limit: 100, total: plans.length, total_pages: 1 },
          })
        );
      }
      if (
        /\/projects\/[\w-]+\/milestones(\?|$)/.test(target) &&
        method === "GET"
      ) {
        if (optionsError) {
          return Promise.resolve(
            jsonResponse(400, {
              error: { code: "VALIDATION_ERROR", message: "Nope." },
            })
          );
        }
        return Promise.resolve(
          jsonResponse(200, {
            data: milestones,
            meta: {
              page: 1,
              limit: 100,
              total: milestones.length,
              total_pages: 1,
            },
          })
        );
      }
      if (/\/projects\/[\w-]+$/.test(target) && method === "GET") {
        return Promise.resolve(jsonResponse(200, { data: project }));
      }
      if (/\/projects(\?|$)/.test(target) && method === "GET") {
        return Promise.resolve(
          jsonResponse(200, {
            data: projects,
            meta: {
              page: 1,
              limit: 1,
              total: projects.length,
              total_pages: 1,
            },
          })
        );
      }
      return Promise.reject(new Error(`unexpected ${method} ${target}`));
    }
  );
}

async function renderPage(): Promise<{
  view: ReturnType<typeof render>;
  tree: () => React.ReactElement;
}> {
  const { default: ReportsPage } = await import("@/app/(app)/reports/page");
  const { RequireAuth } = await import("@/components/require-auth");
  const { SessionProvider } = await import("@/lib/session");
  // A builder, not an element: rerendering the same element object lets React
  // bail out of the subtree, and the page would never see the new URL.
  const tree = () => (
    <SessionProvider>
      <RequireAuth>
        <ReportsPage />
      </RequireAuth>
    </SessionProvider>
  );
  const view = render(tree());
  return { view, tree };
}

/**
 * The mocked router does not re-render on `replace`, so a test that wants the
 * next request changes the URL by hand and rerenders — the same thing the real
 * router does after `router.replace`.
 */
function moveTo(
  view: ReturnType<typeof render>,
  tree: () => React.ReactElement,
  search: string
): void {
  mockRouterState.search = search;
  view.rerender(tree());
}

function summaryCalls(): string[] {
  return fetchMock.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.includes("/reports/summary"));
}

function lastSummaryUrl(): string {
  const calls = summaryCalls();
  return calls[calls.length - 1] ?? "";
}

function lastReplaceUrl(): string {
  const calls = mockRouterState.replace.mock.calls;
  return String(calls[calls.length - 1]?.[0] ?? "");
}

function tile(name: string): HTMLElement {
  return screen.getByRole("group", { name });
}

beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  mockRouterState.search = "project=p-1";
  mockRouterState.replace = jest.fn();
  mockRouterState.push = jest.fn();
});

describe("reports screen", () => {
  it("shows the breadcrumb, title, four tiles, failures card and progress table from one request", async () => {
    mockApi();
    await renderPage();

    expect(
      await screen.findByRole("heading", { name: "Reports" })
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("link", { name: "← Payments" })
    ).toHaveAttribute("href", "/projects/p-1");

    await screen.findByText("97.9%");
    expect(within(tile("Pass rate")).getByText("97.9%")).toBeInTheDocument();
    expect(within(tile("Pass rate")).getByText("last 30 days")).toBeInTheDocument();
    expect(within(tile("Results recorded")).getByText("490")).toBeInTheDocument();
    expect(within(tile("Runs")).getByText("1")).toBeInTheDocument();
    expect(within(tile("Runs")).getByText("in this project")).toBeInTheDocument();
    expect(within(tile("Items complete")).getByText("84%")).toBeInTheDocument();
    expect(
      within(tile("Items complete")).getByText("42 of 50 items")
    ).toBeInTheDocument();

    expect(
      screen.getByRole("heading", {
        name: "Failures over time, last 30 days",
      })
    ).toBeInTheDocument();
    expect(screen.getByText("Release 2.4 smoke")).toBeInTheDocument();

    expect(summaryCalls()).toHaveLength(1);
  });

  it("defaults to 30 days and writes a changed window without rewriting the default", async () => {
    mockApi();
    const { view, tree } = await renderPage();

    await screen.findByText("97.9%");
    expect(summaryCalls()[0]).toContain("days=30");

    fireEvent.click(screen.getByRole("button", { name: "Last 7 days" }));

    await waitFor(() =>
      expect(mockRouterState.replace).toHaveBeenCalledWith(
        "/reports?project=p-1&days=7",
        { scroll: false }
      )
    );

    moveTo(view, tree, "project=p-1&days=7");
    await waitFor(() => expect(summaryCalls()).toHaveLength(2));
    await waitFor(() => expect(lastSummaryUrl()).toContain("days=7"));
    expect(
      screen.getByRole("button", { name: "Last 7 days" })
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("maps the plan, milestone and status filters to the API and shows Reset filters only when they are set", async () => {
    mockApi();
    const { view, tree } = await renderPage();
    await screen.findByText("97.9%");

    const plan = screen.getByRole("combobox", { name: "Plan" });
    expect(plan).toHaveDisplayValue("All plans");

    fireEvent.change(plan, { target: { value: "none" } });

    await waitFor(() =>
      expect(lastReplaceUrl()).toBe("/reports?project=p-1&plan=none")
    );

    moveTo(view, tree, "project=p-1&plan=none");
    expect(
      screen.getByRole("button", { name: "Reset filters" })
    ).toBeInTheDocument();
    await waitFor(() => expect(lastSummaryUrl()).toContain("plan_id=none"));
    expect(screen.getByRole("combobox", { name: "Plan" })).toHaveDisplayValue(
      "No plan"
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
    await waitFor(() => expect(lastReplaceUrl()).toBe("/reports?project=p-1"));

    moveTo(view, tree, "project=p-1");
    expect(
      screen.queryByRole("button", { name: "Reset filters" })
    ).not.toBeInTheDocument();
    await waitFor(() => expect(lastSummaryUrl()).not.toContain("plan_id"));
    expect(screen.getByRole("combobox", { name: "Plan" })).toHaveDisplayValue(
      "All plans"
    );
  });

  it("keeps the tiles honest for an empty project", async () => {
    mockApi({
      summary: summary({
        trend: {
          buckets: [],
          totals: {
            status_counts: {
              passed: 0,
              failed: 0,
              blocked: 0,
              retest: 0,
              skipped: 0,
            },
            total: 0,
            pass_rate: null,
          },
        },
        progress: {
          data: [],
          meta: { page: 1, limit: 25, total: 0, total_pages: 1 },
          items: { total: 0, with_results: 0, untested: 0, percent_complete: 0 },
        },
      }),
    });
    await renderPage();

    await screen.findByText("No verdicts in this window");
    expect(within(tile("Pass rate")).getByText("—")).toBeInTheDocument();
    expect(
      within(tile("Pass rate")).getByText("No verdicts in this window")
    ).toBeInTheDocument();
    expect(within(tile("Results recorded")).getByText("0")).toBeInTheDocument();
    expect(within(tile("Runs")).getByText("0")).toBeInTheDocument();
    expect(within(tile("Items complete")).getByText("0%")).toBeInTheDocument();
  });

  it("shows one page-level error with Retry and keeps the filter bar", async () => {
    mockApi({ summaryError: true });
    await renderPage();

    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(
      "Couldn't load this report. Check your connection and retry."
    );

    const windowButton = screen.getByRole("button", { name: "Last 7 days" });
    expect(windowButton).toBeEnabled();

    const before = summaryCalls().length;
    fireEvent.click(within(alerts[0]).getByRole("button", { name: "Retry" }));

    await waitFor(() =>
      expect(summaryCalls().length).toBeGreaterThan(before)
    );
  });

  it("resolves the first project when the URL has none", async () => {
    mockRouterState.search = "";
    mockApi();
    await renderPage();

    await waitFor(() =>
      expect(mockRouterState.replace).toHaveBeenCalledWith(
        "/reports?project=p-1",
        { scroll: false }
      )
    );
    expect(
      fetchMock.mock.calls.some(([url]) =>
        /\/projects\?page=1&limit=1$/.test(String(url))
      )
    ).toBe(true);
  });

  it("falls back to 30 days for a URL value outside the presets", async () => {
    mockRouterState.search = "project=p-1&days=3";
    mockApi();
    await renderPage();

    await screen.findByText("97.9%");
    expect(summaryCalls()[0]).toContain("days=30");
    expect(new URL(summaryCalls()[0]).searchParams.get("days")).toBe("30");
  });
});