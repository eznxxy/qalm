import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import type { Plan, Project, Run, User } from "@/lib/api-types";

/**
 * Plan detail (card 3.3). A plan is a thin container: the screen shows its own
 * fields, the rollup headline and a read-only list of its runs, and it links a
 * run through to the run detail route. These tests pin the rollup copy, the
 * `plan_id` filter the page sends, the empty state and the 404.
 */

const mockRouteState = {
  planId: "pl-1",
  search: "project=p-1",
};

const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: jest.fn(),
    push: mockPush,
    back: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => "/plans/pl-1",
  useParams: () => ({ id: mockRouteState.planId }),
  useSearchParams: () => new URLSearchParams(mockRouteState.search),
}));

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const USER: User = {
  id: "u-1",
  email: "ada@example.com",
  name: "Ada Lovelace",
  role: "tester",
  is_active: true,
  must_change_password: false,
  created_at: "2026-10-07T12:00:00Z",
  updated_at: "2026-10-07T12:00:00Z",
};

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
  description: "Regression sweep before the 2.4 release.",
  due_date: "2026-11-14",
  run_count: 2,
  counts: {
    total: 8,
    passed: 3,
    failed: 1,
    blocked: 0,
    retest: 0,
    skipped: 1,
    untested: 3,
    percent_complete: 63,
  },
  created_by: "u-1",
  updated_by: "u-1",
  created_at: "2026-10-20T12:00:00Z",
  updated_at: "2026-10-20T12:00:00Z",
};

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    project_id: "p-1",
    plan_id: "pl-1",
    name: "Release 2.4 smoke",
    description: null,
    status: "open",
    start_date: null,
    due_date: "2026-11-10",
    completed_at: null,
    completed_by: null,
    counts: {
      total: 5,
      passed: 2,
      failed: 0,
      blocked: 0,
      retest: 0,
      skipped: 0,
      untested: 3,
      percent_complete: 40,
    },
    assignee_ids: [],
    suite_ids: [],
    created_by: "u-1",
    updated_by: "u-1",
    created_at: "2026-10-21T12:00:00Z",
    updated_at: "2026-10-21T12:00:00Z",
    ...overrides,
  };
}

const RUN = makeRun({
  assignee_ids: ["u-1", "u-2"],
  start_date: "2026-11-01",
});
const COMPLETED_RUN = makeRun({
  id: "run-2",
  name: "Release 2.4 regression",
  status: "completed",
  due_date: null,
  counts: {
    total: 3,
    passed: 3,
    failed: 0,
    blocked: 0,
    retest: 0,
    skipped: 0,
    untested: 0,
    percent_complete: 100,
  },
});

const runCalls: string[] = [];

function mockApi({
  planStatus = 200,
  runs = [RUN, COMPLETED_RUN],
}: { planStatus?: number; runs?: Run[] } = {}): jest.Mock {
  const fetchMock = jest.fn(
    (url: string, init?: { method?: string }) => {
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
        return Promise.resolve(jsonResponse(200, { data: USER }));
      }
      if (/\/plans\/[\w-]+$/.test(target) && method === "GET") {
        if (planStatus === 404) {
          return Promise.resolve(
            jsonResponse(404, {
              error: { code: "not_found", message: "Plan not found." },
            })
          );
        }
        return Promise.resolve(jsonResponse(200, { data: PLAN }));
      }
      if (/\/projects\/[\w-]+\/runs(\?|$)/.test(target) && method === "GET") {
        runCalls.push(target);
        return Promise.resolve(
          jsonResponse(200, {
            data: runs,
            meta: { page: 1, limit: 100, total: runs.length, total_pages: 1 },
          })
        );
      }
      if (/\/projects\/[\w-]+$/.test(target) && method === "GET") {
        return Promise.resolve(jsonResponse(200, { data: PROJECT }));
      }
      return Promise.reject(new Error(`unexpected ${method} ${target}`));
    }
  );
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

async function renderPage(): Promise<ReturnType<typeof render>> {
  const { default: PlanDetailPage } = await import("@/app/(app)/plans/[id]/page");
  const { RequireAuth } = await import("@/components/require-auth");
  const { SessionProvider } = await import("@/lib/session");
  return render(
    <SessionProvider>
      <RequireAuth>
        <PlanDetailPage />
      </RequireAuth>
    </SessionProvider>
  );
}

beforeEach(() => {
  mockRouteState.planId = "pl-1";
  mockRouteState.search = "project=p-1";
  runCalls.length = 0;
  mockPush.mockClear();
});

describe("plan detail", () => {
  it("shows the plan's fields and the rollup headline", async () => {
    mockApi();
    await renderPage();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Release 2.4" })
    ).toBeInTheDocument();
    expect(
      screen.getByText("Regression sweep before the 2.4 release.")
    ).toBeInTheDocument();
    expect(screen.getByText("14 Nov 2026")).toBeInTheDocument();
    expect(
      screen.getByText("63% complete · 8 items · 2 runs")
    ).toBeInTheDocument();
  });

  it("renders the runs table exactly like the runs list, minus the Plan column", async () => {
    mockApi();
    await renderPage();

    const table = await screen.findByRole("table", { name: "Plan runs" });
    expect(
      await within(table).findByText("Release 2.4 smoke")
    ).toBeInTheDocument();

    expect(runCalls[0]).toContain("plan_id=pl-1");
    expect(runCalls[0]).toContain("sort=-created_at");

    // Same column order as the runs screen: the plan's own page drops only
    // the Plan column, which would repeat the page title in every row.
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent?.trim() ?? "");
    expect(headers).toEqual([
      "Name",
      "Status",
      "% complete",
      "Assignees",
      "Start date",
      "Due date",
    ]);

    // A status bar + percentage per run (no more Open/Completed chip).
    expect(
      within(table).getByRole("img", { name: /Release 2.4 smoke:/ })
    ).toBeInTheDocument();
    expect(within(table).getByText("40%")).toBeInTheDocument();
    expect(within(table).getByText("100%")).toBeInTheDocument();

    // Assignee ids are a count, as on the runs list.
    expect(within(table).getByText("2 assignees")).toBeInTheDocument();

    // Dates are YYYY-MM-DD rendered without a day shift.
    expect(within(table).getByText("1 Nov 2026")).toBeInTheDocument();
    expect(within(table).getByText("10 Nov 2026")).toBeInTheDocument();
  });

  it("opens a run from its name", async () => {
    mockApi();
    await renderPage();

    const table = await screen.findByRole("table", { name: "Plan runs" });
    await within(table).findByText("Release 2.4 smoke");
    fireEvent.click(
      within(table).getByRole("button", { name: "Open run Release 2.4 smoke" })
    );
    expect(mockPush).toHaveBeenCalledWith("/runs/run-1?project=p-1");
  });

  it("says so when the plan has no runs", async () => {
    mockApi({ runs: [] });
    await renderPage();

    expect(
      await screen.findByText("No runs in this plan yet.")
    ).toBeInTheDocument();
  });

  it("shows not found for a deleted plan", async () => {
    mockApi({ planStatus: 404 });
    await renderPage();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Plan not found" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to test plans" })
    ).toBeInTheDocument();
  });
});