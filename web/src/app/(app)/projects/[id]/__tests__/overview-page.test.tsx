import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import type {
  Milestone,
  Plan,
  Project,
  ProjectTrend,
  Role,
  Run,
  TrendBucket,
  User,
} from "@/lib/api-types";

/**
 * Project overview (docs/DESIGN.md §4.8, docs/PRD-project-overview.md).
 *
 * Covers what the components do not own: the tab strip's routes and the
 * disabled Reports tab, the 1/7/14/30 window read from and written to the URL,
 * the trend chart/table toggle, the two summary cards and their links, the
 * empty states, and the Admin/Lead create gating.
 */

const mockRouterState = {
  search: "",
  params: { id: "p-1" } as Record<string, string>,
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
  usePathname: () => "/projects/p-1",
  useParams: () => mockRouterState.params,
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
  key: "CHK",
  name: "Checkout",
  description: "Cart, payment and receipt flows",
  status: "active",
  created_by: "u-1",
  created_at: "2026-10-07T12:00:00Z",
  updated_at: "2026-10-24T09:00:00Z",
};

const PLAN: Plan = {
  id: "pl-1",
  project_id: "p-1",
  name: "Release 2.4",
  description: null,
  due_date: "2026-11-14",
  run_count: 1,
  counts: {
    total: 50,
    passed: 31,
    failed: 4,
    blocked: 2,
    retest: 2,
    skipped: 0,
    untested: 11,
    percent_complete: 78,
  },
  created_by: "u-1",
  updated_by: "u-1",
  created_at: "2026-10-20T12:00:00Z",
  updated_at: "2026-10-20T12:00:00Z",
};

const MILESTONE: Milestone = {
  id: "m-1",
  project_id: "p-1",
  name: "Release 2.4",
  description: null,
  due_date: "2026-11-14",
  status: "open",
  run_count: 2,
  counts: {
    total: 8,
    passed: 5,
    failed: 1,
    blocked: 0,
    retest: 0,
    skipped: 0,
    untested: 2,
    percent_complete: 63,
  },
  created_by: "u-1",
  updated_by: "u-1",
  created_at: "2026-10-20T12:00:00Z",
  updated_at: "2026-10-20T12:00:00Z",
};

const RUN: Run = {
  id: "r-1",
  project_id: "p-1",
  plan_id: "pl-1",
  milestone_id: "m-1",
  milestone_name: "Release 2.4",
  name: "Release 2.4 smoke",
  description: null,
  status: "open",
  start_date: "2026-11-01",
  due_date: "2026-11-14",
  completed_at: null,
  completed_by: null,
  counts: {
    total: 50,
    passed: 31,
    failed: 4,
    blocked: 2,
    retest: 2,
    skipped: 0,
    untested: 11,
    percent_complete: 78,
  },
  assignee_ids: [],
  suite_ids: [],
  created_by: "u-1",
  updated_by: "u-1",
  created_at: "2026-10-24T09:00:00Z",
  updated_at: "2026-10-24T09:00:00Z",
};

function bucket(date: string): TrendBucket {
  return {
    date,
    status_counts: {
      passed: 0,
      failed: 0,
      blocked: 0,
      retest: 0,
      skipped: 0,
    },
    total: 0,
    pass_rate: null,
  };
}

/** A trend response with `days` zero-filled buckets and two busy days. */
function makeTrend(days: number, empty = false): ProjectTrend {
  const buckets = Array.from({ length: days }, (_, index) =>
    bucket(`2026-10-${String(index + 1).padStart(2, "0")}`)
  );
  if (!empty) {
    buckets[Math.max(0, days - 2)] = {
      date: "2026-10-27",
      status_counts: { passed: 3, failed: 1, blocked: 0, retest: 0, skipped: 0 },
      total: 4,
      pass_rate: 75,
    };
    buckets[Math.max(0, days - 1)] = {
      date: "2026-10-28",
      status_counts: { passed: 2, failed: 1, blocked: 0, retest: 0, skipped: 0 },
      total: 3,
      pass_rate: 66.7,
    };
  }
  return {
    project_id: "p-1",
    from: "2026-10-15",
    to: "2026-10-28",
    days,
    buckets,
    totals: {
      status_counts: empty
        ? { passed: 0, failed: 0, blocked: 0, retest: 0, skipped: 0 }
        : { passed: 5, failed: 2, blocked: 0, retest: 0, skipped: 0 },
      total: empty ? 0 : 7,
      pass_rate: empty ? null : 71.4,
    },
  };
}

let fetchMock: jest.Mock;

interface ApiOptions {
  role?: Role;
  project?: Project;
  trend?: ProjectTrend;
  trendError?: boolean;
  milestones?: Milestone[];
  runs?: Run[];
  plans?: Plan[];
}

function mockApi({
  role = "admin",
  project = PROJECT,
  trend = makeTrend(14),
  trendError = false,
  milestones = [MILESTONE],
  runs = [RUN],
  plans = [PLAN],
}: ApiOptions = {}): void {
  const user = makeUser({ role });
  fetchMock.mockImplementation((url: string) => {
    const target = String(url);

    if (target.includes("/auth/refresh")) {
      return Promise.resolve(
        jsonResponse(200, {
          data: { access_token: "tok-r", token_type: "Bearer", expires_in: 900 },
        })
      );
    }
    if (target.includes("/auth/me")) {
      return Promise.resolve(jsonResponse(200, { data: user }));
    }
    if (/\/projects\/[\w-]+\/reports\/trend(\?|$)/.test(target)) {
      if (trendError) {
        return Promise.resolve(
          jsonResponse(500, {
            error: { code: "INTERNAL", message: "Trend is unavailable." },
          })
        );
      }
      return Promise.resolve(jsonResponse(200, { data: trend }));
    }
    if (/\/projects\/[\w-]+\/milestones(\?|$)/.test(target)) {
      return Promise.resolve(
        jsonResponse(200, {
          data: milestones,
          meta: { page: 1, limit: 5, total: milestones.length, total_pages: 1 },
        })
      );
    }
    if (/\/projects\/[\w-]+\/runs(\?|$)/.test(target)) {
      return Promise.resolve(
        jsonResponse(200, {
          data: runs,
          meta: { page: 1, limit: 5, total: runs.length, total_pages: 1 },
        })
      );
    }
    if (/\/projects\/[\w-]+\/plans(\?|$)/.test(target)) {
      return Promise.resolve(
        jsonResponse(200, {
          data: plans,
          meta: { page: 1, limit: 100, total: plans.length, total_pages: 1 },
        })
      );
    }
    if (/\/projects\/[\w-]+$/.test(target)) {
      return Promise.resolve(jsonResponse(200, { data: project }));
    }
    return Promise.reject(new Error(`unexpected GET ${target}`));
  });
}

async function renderPage(): Promise<ReturnType<typeof render>> {
  const { default: ProjectDetailPage } = await import(
    "@/app/(app)/projects/[id]/page"
  );
  const { RequireAuth } = await import("@/components/require-auth");
  const { SessionProvider } = await import("@/lib/session");
  return render(
    <SessionProvider>
      <RequireAuth>
        <ProjectDetailPage />
      </RequireAuth>
    </SessionProvider>
  );
}

function trendCalls(): string[] {
  return fetchMock.mock.calls
    .map(([url]) => String(url))
    .filter((url) => /\/reports\/trend(\?|$)/.test(url));
}

function lastReplaceUrl(): string {
  const calls = mockRouterState.replace.mock.calls;
  return String(calls[calls.length - 1]?.[0] ?? "");
}

beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  mockRouterState.search = "";
  mockRouterState.params = { id: "p-1" };
  mockRouterState.replace = jest.fn();
  mockRouterState.push = jest.fn();
});

describe("overview: tab strip", () => {
  it("links each tab to its project-filtered route and marks Overview current", async () => {
    mockApi();
    await renderPage();

    const tabs = await screen.findByRole("navigation", {
      name: "Project sections",
    });
    const overview = within(tabs).getByRole("link", { name: "Overview" });
    expect(overview).toHaveAttribute("href", "/projects/p-1");
    expect(overview).toHaveAttribute("aria-current", "page");
    expect(
      within(tabs).getByRole("link", { name: "Milestones" })
    ).toHaveAttribute("href", "/milestones?project=p-1");
    expect(within(tabs).getByRole("link", { name: "Test runs" })).toHaveAttribute(
      "href",
      "/runs?project=p-1"
    );
    expect(within(tabs).getByRole("link", { name: "Test cases" })).toHaveAttribute(
      "href",
      "/cases?project=p-1"
    );
  });

  it("shows Reports disabled with a reason and no link", async () => {
    mockApi();
    await renderPage();

    const reports = await screen.findByText("Reports");
    expect(reports.closest("a")).toBeNull();
    expect(reports).toHaveAttribute("aria-disabled", "true");
    expect(reports).toHaveAttribute("title", "Reports arrive in a later slice");
  });
});

describe("overview: trend window", () => {
  it("defaults to 14 days, requests them, and titles the card from the response window", async () => {
    mockApi();
    await renderPage();

    expect(
      await screen.findByRole("heading", {
        name: "Results recorded, last 14 days",
      })
    ).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Last 14 days" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(trendCalls()).toHaveLength(1);
    expect(trendCalls()[0]).toContain("days=14");
  });

  it("reads the window from the URL and highlights that preset", async () => {
    mockRouterState.search = "days=7";
    mockApi({ trend: makeTrend(7) });
    await renderPage();

    expect(
      await screen.findByRole("heading", {
        name: "Results recorded, last 7 days",
      })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Last 7 days" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "Last 14 days" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(trendCalls()[0]).toContain("days=7");
  });

  it.each([1, 30])("offers %sd and writes it to the URL", async (preset) => {
    mockApi();
    await renderPage();

    const label = preset === 1 ? "Last 1 day" : "Last 30 days";
    fireEvent.click(await screen.findByRole("button", { name: label }));

    await waitFor(() =>
      expect(mockRouterState.replace).toHaveBeenCalledWith(
        `/projects/p-1?days=${preset}`,
        { scroll: false }
      )
    );
    expect(lastReplaceUrl()).toContain(`days=${preset}`);
  });

  it("falls back to 14 days for an unknown window in the URL", async () => {
    mockRouterState.search = "days=99";
    mockApi();
    await renderPage();

    expect(
      await screen.findByRole("heading", {
        name: "Results recorded, last 14 days",
      })
    ).toBeInTheDocument();
    expect(trendCalls()[0]).toContain("days=14");
  });

  it("labels the card for a single day without claiming a range", async () => {
    mockRouterState.search = "days=1";
    mockApi({ trend: makeTrend(1) });
    await renderPage();

    expect(
      await screen.findByRole("heading", { name: "Results recorded, today" })
    ).toBeInTheDocument();
  });
});

describe("overview: trend chart and table", () => {
  it("renders one chart summary naming the totals and statuses", async () => {
    mockApi();
    await renderPage();

    const chart = await screen.findByRole("img", { name: /Results recorded/ });
    expect(chart).toHaveAccessibleName(
      /7 results, 71.4% pass rate\. Passed 5, Failed 2, Blocked 0, Retest 0, Skipped 0/
    );
  });

  it("headlines the window pass rate and result count above the plot", async () => {
    mockApi();
    await renderPage();

    expect(await screen.findByText("71.4%")).toBeInTheDocument();
    expect(screen.getByText("pass rate")).toBeInTheDocument();
    expect(screen.getByText("7 results")).toBeInTheDocument();
  });

  it("omits the headline for an empty window instead of showing a bare dash", async () => {
    mockRouterState.search = "days=30";
    mockApi({ trend: makeTrend(30, true) });
    await renderPage();

    expect(
      await screen.findByText("No results recorded in the last 30 days.")
    ).toBeInTheDocument();
    expect(document.querySelector(".ov-trend-summary")).toBeNull();
    expect(screen.queryByText("0 results")).toBeNull();
  });

  it("names every status in the legend, plus the pass-rate line", async () => {
    mockApi();
    await renderPage();

    const legend = await screen.findByRole("list", { name: "Legend" });
    for (const label of ["Passed", "Failed", "Blocked", "Retest", "Skipped", "Pass rate"]) {
      expect(within(legend).getByText(label)).toBeInTheDocument();
    }
  });

  it("toggles to a daily table and back", async () => {
    mockApi();
    await renderPage();

    const toggle = await screen.findByRole("button", { name: "View as table" });
    fireEvent.click(toggle);

    const table = await screen.findByRole("table", {
      name: /Results recorded, last 14 days/,
    });
    expect(within(table).getByRole("columnheader", { name: "Pass rate" })).toBeInTheDocument();
    expect(within(table).getByRole("rowheader", { name: "27 Oct 2026" })).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(screen.getByRole("button", { name: "View as chart" }));
    expect(await screen.findByRole("img", { name: /Results recorded/ })).toBeInTheDocument();
  });

  it("renders the window's empty copy when nothing was recorded", async () => {
    mockApi({ trend: makeTrend(30, true) });
    mockRouterState.search = "days=30";
    await renderPage();

    expect(
      await screen.findByText("No results recorded in the last 30 days.")
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Test runs" })).toHaveAttribute(
      "href",
      "/runs?project=p-1"
    );
  });

  it("keeps the failure inside the trend card and retries only it", async () => {
    mockApi({ trendError: true });
    await renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Trend is unavailable.");

    // The other cards still load.
    expect(await screen.findByText("Release 2.4 smoke")).toBeInTheDocument();

    const callsBefore = trendCalls().length;
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(trendCalls().length).toBeGreaterThan(callsBefore)
    );
  });
});

describe("overview: summary cards", () => {
  it("shows the nearest milestones and the newest runs with their links", async () => {
    mockApi();
    await renderPage();

    const milestoneName = await screen.findByText("Release 2.4", {
      selector: ".ov-ms-name",
    });
    const milestone = milestoneName.closest("a");
    expect(milestone).toHaveAttribute("href", "/milestones/m-1?project=p-1");
    expect(within(milestone!).getByText("14 Nov 2026")).toBeInTheDocument();
    expect(within(milestone!).getByText("63%")).toBeInTheDocument();

    const runs = await screen.findByRole("link", {
      name: /Release 2\.4 smoke/,
    });
    expect(runs).toHaveAttribute("href", "/runs/r-1?project=p-1");
    expect(within(runs).getByText("Plan: Release 2.4")).toBeInTheDocument();
    expect(within(runs).getByText("39 of 50")).toBeInTheDocument();
    expect(within(runs).getByText("78% complete")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: "View all milestones" })).toHaveAttribute(
      "href",
      "/milestones?project=p-1"
    );
    expect(screen.getByRole("link", { name: "View all runs" })).toHaveAttribute(
      "href",
      "/runs?project=p-1"
    );
  });

  it("admin: empty cards offer the create shortcuts", async () => {
    mockApi({ milestones: [], runs: [], trend: makeTrend(14, true) });
    await renderPage();

    expect(await screen.findByText("No milestones yet. Create one to track a release.")).toBeInTheDocument();
    const newMilestone = await screen.findByRole("link", { name: "New milestone" });
    expect(newMilestone).toHaveAttribute(
      "href",
      "/milestones?project=p-1&new=1"
    );

    expect(
      await screen.findByText("No runs yet. Create a run to start recording results.")
    ).toBeInTheDocument();
    const newRun = await screen.findByRole("link", { name: "New run" });
    expect(newRun).toHaveAttribute("href", "/runs?project=p-1&new=1");
  });

  it("tester: empty cards explain the rule instead of offering a shortcut", async () => {
    mockApi({
      role: "tester",
      milestones: [],
      runs: [],
      trend: makeTrend(14, true),
    });
    await renderPage();

    expect(
      await screen.findByText("Only Admins and Leads can create milestones.")
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Only Admins and Leads can create runs.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "New milestone" })).toBeNull();
    expect(screen.queryByRole("link", { name: "New run" })).toBeNull();
  });

  it("archived project: admins still read the cards, with no create shortcuts", async () => {
    mockApi({
      project: { ...PROJECT, status: "archived" },
      milestones: [],
      runs: [],
      trend: makeTrend(14, true),
    });
    await renderPage();

    expect(
      await screen.findByText("Only Admins and Leads can create milestones.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "New milestone" })).toBeNull();
  });
});