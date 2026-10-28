import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type {
  Milestone,
  Plan,
  Project,
  Role,
  Run,
  User,
} from "@/lib/api-types";
import { formatDaysLeft } from "@/lib/dates";

/**
 * Milestone detail (docs/DESIGN.md §4.5, docs/backlog-slice4-milestones.md card
 * 3.1). Covers the derived rollup, the runs table (Plan kept, Milestone dropped,
 * Actions added), Add runs over `milestone_id=none`, per-row Remove, edit and
 * delete, and the Admin/Lead + archived read-only rules. The countdown copy is
 * asserted through @/lib/dates, the only place it is built.
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
  usePathname: () => "/milestones/m-1",
  useParams: () => ({ id: "m-1" }),
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

const ARCHIVED: Project = { ...PROJECT, status: "archived" };

const PLAN: Plan = {
  id: "pl-1",
  project_id: "p-1",
  name: "Release 2.4",
  description: null,
  due_date: "2026-11-14",
  run_count: 1,
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

const MILESTONE: Milestone = {
  id: "m-1",
  project_id: "p-1",
  name: "2.4 release",
  description: "Ship 2.4 to production.",
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

function run(overrides: Partial<Run> & { id: string; name: string }): Run {
  return {
    project_id: "p-1",
    plan_id: null,
    milestone_id: null,
    milestone_name: null,
    description: null,
    status: "open",
    start_date: null,
    due_date: null,
    completed_at: null,
    completed_by: null,
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
    assignee_ids: [],
    suite_ids: [],
    created_by: "u-1",
    updated_by: "u-1",
    created_at: "2026-10-24T09:00:00Z",
    updated_at: "2026-10-24T09:00:00Z",
    ...overrides,
  };
}

const ATTACHED: Run[] = [
  run({
    id: "r-1",
    name: "Release 2.4 smoke",
    plan_id: "pl-1",
    milestone_id: "m-1",
    milestone_name: "2.4 release",
    start_date: "2026-11-01",
    due_date: "2026-11-10",
  }),
  run({ id: "r-2", name: "Release 2.4 regression", milestone_id: "m-1" }),
];

/** Unattached runs the Add runs dialog may offer. */
const CANDIDATES: Run[] = [
  run({ id: "r-3", name: "Ad-hoc checkout" }),
  run({ id: "r-4", name: "Ad-hoc refunds" }),
];

let fetchMock: jest.Mock;

interface ApiOptions {
  role?: Role;
  project?: Project;
  milestone?: Milestone | null;
  runs?: Run[];
  candidates?: Run[];
  /** Reject the first `milestone_id=none` request so Retry can be seen. */
  candidatesError?: boolean;
  /** Fail the attach with a run_ids[i] field error. */
  attachError?: boolean;
}

function mockApi({
  role = "admin",
  project = PROJECT,
  milestone = MILESTONE,
  runs = ATTACHED,
  candidates = CANDIDATES,
  candidatesError = false,
  attachError = false,
}: ApiOptions = {}): void {
  const user = makeUser({ role });
  let candidateFetches = 0;
  fetchMock.mockImplementation(
    (url: string, init?: { method?: string; body?: string }) => {
      const target = String(url);
      const method = init?.method ?? "GET";
      const parsed = new URL(target, "http://qalm.test");

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
      if (target.endsWith("/milestones/m-1/runs") && method === "POST") {
        if (attachError) {
          return Promise.resolve(
            jsonResponse(400, {
              error: {
                code: "VALIDATION_ERROR",
                message: "Validation failed.",
                details: [
                  { field: "run_ids[0]", issue: "already in another milestone" },
                ],
              },
            })
          );
        }
        return Promise.resolve(jsonResponse(200, { data: { attached: 1 } }));
      }
      if (/\/milestones\/m-1\/runs\/[\w-]+$/.test(target) && method === "DELETE") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (target.endsWith("/milestones/m-1") && method === "PATCH") {
        return Promise.resolve(
          jsonResponse(200, {
            data: { ...MILESTONE, ...JSON.parse(init?.body ?? "{}") },
          })
        );
      }
      if (target.endsWith("/milestones/m-1") && method === "DELETE") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (target.endsWith("/milestones/m-1") && method === "GET") {
        if (!milestone) {
          return Promise.resolve(
            jsonResponse(404, {
              error: { code: "NOT_FOUND", message: "Milestone not found." },
            })
          );
        }
        return Promise.resolve(jsonResponse(200, { data: milestone }));
      }
      if (/\/projects\/[\w-]+\/runs(\?|$)/.test(target) && method === "GET") {
        if (parsed.searchParams.get("milestone_id") === "none") {
          if (candidatesError && candidateFetches === 0) {
            candidateFetches += 1;
            return Promise.resolve(
              jsonResponse(400, {
                error: {
                  code: "VALIDATION_ERROR",
                  message:
                    "Couldn't load the runs to add. Check your connection and retry.",
                },
              })
            );
          }
          candidateFetches += 1;
          return Promise.resolve(
            jsonResponse(200, {
              data: candidates,
              meta: {
                page: 1,
                limit: 100,
                total: candidates.length,
                total_pages: 1,
              },
            })
          );
        }
        return Promise.resolve(
          jsonResponse(200, {
            data: runs,
            meta: { page: 1, limit: 100, total: runs.length, total_pages: 1 },
          })
        );
      }
      if (/\/projects\/[\w-]+\/plans(\?|$)/.test(target) && method === "GET") {
        return Promise.resolve(
          jsonResponse(200, {
            data: [PLAN],
            meta: { page: 1, limit: 100, total: 1, total_pages: 1 },
          })
        );
      }
      if (/\/projects\/[\w-]+$/.test(target) && method === "GET") {
        return Promise.resolve(jsonResponse(200, { data: project }));
      }
      return Promise.reject(new Error(`unexpected ${method} ${target}`));
    }
  );
}

async function renderPage(): Promise<ReturnType<typeof render>> {
  const { default: MilestoneDetailPage } = await import(
    "@/app/(app)/milestones/[id]/page"
  );
  const { RequireAuth } = await import("@/components/require-auth");
  const { SessionProvider } = await import("@/lib/session");
  return render(
    <SessionProvider>
      <RequireAuth>
        <MilestoneDetailPage />
      </RequireAuth>
    </SessionProvider>
  );
}

function runCalls(): URL[] {
  return fetchMock.mock.calls
    .map(([url, init]) => ({ url: String(url), init }))
    .filter(
      ({ url, init }) =>
        /\/projects\/[\w-]+\/runs(\?|$)/.test(url) &&
        (init?.method ?? "GET") === "GET"
    )
    .map(({ url }) => new URL(url, "http://qalm.test"));
}

function attachPosts(): unknown[] {
  return fetchMock.mock.calls
    .filter(
      ([url, init]) =>
        String(url).endsWith("/milestones/m-1/runs") && init?.method === "POST"
    )
    .map(([, init]) => JSON.parse(String(init?.body ?? "{}")));
}

function runsTable(): Promise<HTMLElement> {
  return screen.findByRole("table", { name: "Milestone runs" });
}

beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  mockRouterState.search = "project=p-1";
  mockRouterState.replace = jest.fn();
  mockRouterState.push = jest.fn();
});

describe("milestone detail", () => {
  it("renders the fields, derived status and rollup", async () => {
    mockApi();
    await renderPage();

    expect(
      await screen.findByRole("heading", { level: 1, name: "2.4 release" })
    ).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("Ship 2.4 to production.")).toBeInTheDocument();

    // Due date plus the countdown the web owns.
    expect(screen.getByText("14 Nov 2026")).toBeInTheDocument();
    expect(
      screen.getByText(formatDaysLeft("2026-11-14") as string)
    ).toBeInTheDocument();

    // 8 items over 2 runs; the bar and the exact counts agree.
    expect(
      screen.getByText("63% complete · 8 items · 2 runs")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /2\.4 release: 5 passed, 1 failed, 2 untested/ })
    ).toBeInTheDocument();
    expect(
      screen.getByText("5 passed, 1 failed, 2 untested")
    ).toBeInTheDocument();
  });

  it("lists the milestone's runs with the Plan column and an Actions column, but not Milestone", async () => {
    mockApi();
    await renderPage();

    const grid = await runsTable();
    expect(await within(grid).findByText("Release 2.4 smoke")).toBeInTheDocument();

    const url = runCalls()[0] as URL;
    expect(url.searchParams.get("milestone_id")).toBe("m-1");
    expect(url.searchParams.get("limit")).toBe("100");

    const headers = within(grid)
      .getAllByRole("columnheader")
      .map((cell) =>
        (cell.textContent ?? "").replace(/[↕▲▼][\s\S]*$/, "").trim()
      );
    expect(headers).toEqual([
      "Name",
      "Plan",
      "Status",
      "% complete",
      "Assignees",
      "Start date",
      "Due date",
      "Actions",
    ]);

    // Plan ids resolve to names; the Milestone column would just repeat the
    // page title, so it is gone.
    expect(within(grid).getByText("Release 2.4")).toBeInTheDocument();
    expect(within(grid).queryByText("2.4 release")).toBeNull();
  });

  it("adds runs from the unattached list and reloads the table", async () => {
    mockApi();
    await renderPage();
    await runsTable();
    await screen.findByRole("button", { name: "Add runs" });

    fireEvent.click(screen.getByRole("button", { name: "Add runs" }));

    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByLabelText(/Ad-hoc checkout/)
    ).toBeInTheDocument();
    // The picker only ever asks for runs with no milestone.
    await waitFor(() => {
      const candidate = runCalls().find(
        (url) => url.searchParams.get("milestone_id") === "none"
      );
      expect(candidate).toBeDefined();
      expect(candidate?.searchParams.get("sort")).toBe("name");
    });

    fireEvent.click(within(dialog).getByLabelText(/Ad-hoc checkout/));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add 1 run" }));

    await waitFor(() => expect(attachPosts()).toEqual([{ run_ids: ["r-3"] }]));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(
        runCalls().filter((url) => url.searchParams.get("milestone_id") === "m-1")
          .length
      ).toBeGreaterThan(1)
    );
  });

  it("reports a rejected run on its row and keeps the dialog open", async () => {
    mockApi({ attachError: true });
    await renderPage();
    await runsTable();

    fireEvent.click(await screen.findByRole("button", { name: "Add runs" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(await within(dialog).findByLabelText(/Ad-hoc checkout/));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add 1 run" }));

    expect(
      await within(dialog).findByText("already in another milestone")
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("offers a retry when the unattached list fails to load", async () => {
    mockApi({ candidatesError: true });
    await renderPage();
    await runsTable();

    fireEvent.click(await screen.findByRole("button", { name: "Add runs" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByText(/Couldn't load the runs to add/)
    ).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Try again" }));
    expect(
      await within(dialog).findByLabelText(/Ad-hoc checkout/)
    ).toBeInTheDocument();
  });

  it("removes a run from the milestone after confirmation, without touching the run", async () => {
    mockApi();
    await renderPage();
    const grid = await runsTable();
    await within(grid).findByText("Release 2.4 regression");

    fireEvent.click(
      within(grid).getByRole("button", {
        name: "Remove Release 2.4 regression from this milestone",
      })
    );
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent(
      /The run is kept: it stays in the project with its cases, results and attachments/
    );

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Remove from milestone" })
    );

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith("/milestones/m-1/runs/r-2") &&
            init?.method === "DELETE"
        )
      ).toBe(true)
    );
    // The only delete is the detach: the run itself is never deleted.
    const deletes = fetchMock.mock.calls.filter(
      ([, init]) => init?.method === "DELETE"
    );
    expect(deletes).toHaveLength(1);
  });

  it("edits the milestone's own fields", async () => {
    mockApi();
    await renderPage();
    await runsTable();

    fireEvent.click(
      await screen.findByRole("button", { name: "Edit milestone" })
    );
    expect(screen.getByLabelText("Name")).toHaveValue("2.4 release");

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "2.4 release (final)" },
    });
    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save milestone" }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).endsWith("/milestones/m-1") && init?.method === "PATCH"
      );
      expect(JSON.parse(patch?.[1]?.body as string)).toEqual({
        name: "2.4 release (final)",
        description: "Ship 2.4 to production.",
        due_date: null,
      });
    });
  });

  it("deletes the milestone and returns to the list, keeping its runs", async () => {
    mockApi();
    await renderPage();
    await runsTable();

    fireEvent.click(
      await screen.findByRole("button", { name: "Delete milestone" })
    );
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent(
      "Its 2 runs will be kept, without a milestone."
    );

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete milestone" })
    );

    await waitFor(() =>
      expect(mockRouterState.push).toHaveBeenLastCalledWith(
        "/milestones?project=p-1"
      )
    );
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith("/milestones/m-1") && init?.method === "DELETE"
      )
    ).toBe(true);
  });

  it("has no Close action — completion is derived", async () => {
    mockApi();
    await renderPage();
    await runsTable();

    expect(screen.queryByRole("button", { name: /close/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /reopen/i })).toBeNull();
  });

  it("shows the empty state with Add runs when nothing is attached", async () => {
    mockApi({
      milestone: { ...MILESTONE, run_count: 0, counts: { ...MILESTONE.counts, total: 0, passed: 0, failed: 0, untested: 0, percent_complete: 0 } },
      runs: [],
    });
    await renderPage();

    const grid = await runsTable();
    expect(
      await within(grid).findByText("No runs in this milestone yet.")
    ).toBeInTheDocument();
    expect(within(grid).getByRole("button", { name: "Add runs" })).toBeInTheDocument();
    // 0% complete rather than an empty bar.
    expect(screen.getByText("0% complete · 0 items · 0 runs")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /2\.4 release:/ })).toBeNull();
  });

  it("says the milestone does not exist when the API returns 404", async () => {
    mockApi({ milestone: null });
    await renderPage();

    expect(
      await screen.findByRole("heading", { name: "Milestone not found" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to milestones" })
    ).toHaveAttribute("href", "/milestones?project=p-1");
  });

  it("hides every write action from a Tester", async () => {
    mockApi({ role: "tester" });
    await renderPage();
    const grid = await runsTable();
    await within(grid).findByText("Release 2.4 smoke");

    expect(
      await screen.findByText(
        "Read-only: editing a milestone needs the Admin or Lead role."
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit milestone" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete milestone" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add runs" })).toBeNull();
    expect(
      within(grid).queryByRole("columnheader", { name: "Actions" })
    ).toBeNull();
  });

  it("is read-only for everyone when the project is archived", async () => {
    mockApi({ project: ARCHIVED });
    await renderPage();
    await runsTable();

    expect(
      await screen.findByText(
        "This project is archived — this milestone is read-only."
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit milestone" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add runs" })).toBeNull();
  });
});