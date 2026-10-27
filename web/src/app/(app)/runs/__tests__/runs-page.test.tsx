import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import type {
  Plan,
  Project,
  Role,
  Run,
  SuiteNode,
  User,
} from "@/lib/api-types";

/**
 * Test runs list (card 3.1). Covers the behaviour the primitives do not own:
 * the Open-by-default status filter, URL-as-state for the filter/sort/search,
 * the table's column mapping, the New run POST + "open the run" navigation,
 * and the role/archived read-only rules.
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
  usePathname: () => "/runs",
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

const ARCHIVED: Project = { ...PROJECT, status: "archived" };

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

function suite(): SuiteNode {
  return {
    id: "s-1",
    project_id: "p-1",
    parent_id: null,
    name: "Checkout",
    description: null,
    depth: 1,
    position: 1,
    case_count: 3,
    created_by: "u-1",
    created_at: "2026-10-07T12:00:00Z",
    updated_at: "2026-10-07T12:00:00Z",
    children: [],
  };
}

function run(overrides: Partial<Run> & { id: string; name: string }): Run {
  return {
    project_id: "p-1",
    plan_id: null,
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

const ROWS: Run[] = [
  run({
    id: "r-1",
    name: "Release 2.4 smoke",
    plan_id: "pl-1",
    start_date: "2026-11-01",
    due_date: "2026-11-14",
    assignee_ids: ["u-1", "u-2"],
  }),
  run({
    id: "r-2",
    name: "Ad-hoc checkout",
    status: "open",
    counts: {
      total: 0,
      passed: 0,
      failed: 0,
      blocked: 0,
      retest: 0,
      skipped: 0,
      untested: 0,
      percent_complete: 0,
    },
  }),
];

let fetchMock: jest.Mock;

interface ApiOptions {
  role?: Role;
  project?: Project;
  runs?: Run[];
  plans?: Plan[];
  /** Make the create POST fail with a 400 (or a 409 for a duplicate) field error. */
  createError?: boolean | "start_date" | "conflict";
  /** Same for the plan-with-runs POST, keyed the API's way: `runs[1].name`. */
  planCreateError?: boolean | "runs[0].name";
}

function mockApi({
  role = "admin",
  project = PROJECT,
  runs = ROWS,
  plans = [PLAN],
  createError = false,
  planCreateError = false,
}: ApiOptions = {}): void {
  const user = makeUser({ role });
  fetchMock.mockImplementation(
    (url: string, init?: { method?: string; body?: string }) => {
      const target = String(url);
      const method = init?.method ?? "GET";

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
      if (/\/projects\/[\w-]+\/runs$/.test(target) && method === "POST") {
        if (createError) {
          const conflict = createError === "conflict";
          const field = createError === "start_date" ? "start_date" : "name";
          const issue = conflict
            ? "already in use"
            : createError === "start_date"
              ? "must be on or before due_date"
              : "Name is required.";
          return Promise.resolve(
            jsonResponse(conflict ? 409 : 400, {
              error: {
                code: conflict ? "CONFLICT" : "VALIDATION_ERROR",
                message: conflict
                  ? "A run with this name already exists."
                  : "Validation failed.",
                details: [{ field, issue }],
              },
            })
          );
        }
        const body = JSON.parse(init?.body ?? "{}") as { name: string };
        return Promise.resolve(
          jsonResponse(201, { data: run({ id: "r-new", name: body.name }) })
        );
      }
      if (/\/projects\/[\w-]+\/plans$/.test(target) && method === "POST") {
        if (planCreateError) {
          const field = planCreateError === "runs[0].name" ? "runs[0].name" : "name";
          const issue =
            planCreateError === "runs[0].name"
              ? "Run name is required."
              : "Plan name is required.";
          return Promise.resolve(
            jsonResponse(400, {
              error: {
                code: "VALIDATION_ERROR",
                message: "Validation failed.",
                details: [{ field, issue }],
              },
            })
          );
        }
        return Promise.resolve(jsonResponse(201, { data: PLAN }));
      }
      if (/\/projects\/[\w-]+\/runs(\?|$)/.test(target) && method === "GET") {
        return Promise.resolve(
          jsonResponse(200, {
            data: runs,
            meta: { page: 1, limit: 25, total: runs.length, total_pages: 1 },
          })
        );
      }
      if (/\/projects\/[\w-]+\/plans(\?|$)/.test(target) && method === "GET") {
        return Promise.resolve(
          jsonResponse(200, {
            data: plans,
            meta: { page: 1, limit: 100, total: plans.length, total_pages: 1 },
          })
        );
      }
      if (/\/projects\/[\w-]+\/suites$/.test(target) && method === "GET") {
        return Promise.resolve(jsonResponse(200, { data: [suite()] }));
      }
      if (/\/projects\/[\w-]+\/cases(\?|$)/.test(target) && method === "GET") {
        return Promise.resolve(
          jsonResponse(200, {
            data: [],
            meta: { page: 1, limit: 20, total: 0, total_pages: 1 },
          })
        );
      }
      if (/\/projects\/[\w-]+$/.test(target) && method === "GET") {
        return Promise.resolve(jsonResponse(200, { data: project }));
      }
      if (/\/projects(\?|$)/.test(target) && method === "GET") {
        return Promise.resolve(
          jsonResponse(200, {
            data: [project],
            meta: { page: 1, limit: 1, total: 1, total_pages: 1 },
          })
        );
      }
      return Promise.reject(new Error(`unexpected ${method} ${target}`));
    }
  );
}

async function renderPage(): Promise<ReturnType<typeof render>> {
  const { default: RunsPage } = await import("@/app/(app)/runs/page");
  const { RequireAuth } = await import("@/components/require-auth");
  const { SessionProvider } = await import("@/lib/session");
  return render(
    <SessionProvider>
      <RequireAuth>
        <RunsPage />
      </RequireAuth>
    </SessionProvider>
  );
}

function listRunCalls(): string[] {
  return fetchMock.mock.calls
    .map(([url, init]) => ({ url: String(url), init }))
    .filter(
      ({ url, init }) =>
        /\/projects\/[\w-]+\/runs(\?|$)/.test(url) &&
        (init?.method ?? "GET") === "GET"
    )
    .map(({ url }) => url);
}

/** GET /plans calls — the Plan column's source, refreshed after a create. */
function listPlanCalls(): string[] {
  return fetchMock.mock.calls
    .map(([url, init]) => ({ url: String(url), init }))
    .filter(
      ({ url, init }) =>
        /\/projects\/[\w-]+\/plans(\?|$)/.test(url) &&
        (init?.method ?? "GET") === "GET"
    )
    .map(({ url }) => url);
}

function planPosts(): { url: string; body: unknown }[] {
  return fetchMock.mock.calls
    .filter(
      ([url, init]) =>
        /\/projects\/[\w-]+\/plans$/.test(String(url)) &&
        init?.method === "POST"
    )
    .map(([url, init]) => ({
      url: String(url),
      body: JSON.parse(String(init?.body ?? "{}")),
    }));
}

function lastReplaceUrl(): string {
  const calls = mockRouterState.replace.mock.calls;
  return String(calls[calls.length - 1]?.[0] ?? "");
}

beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  mockRouterState.search = "project=p-1";
  mockRouterState.replace = jest.fn();
  mockRouterState.push = jest.fn();
});

describe("runs list", () => {
  it("loads the project's runs with the Open filter by default", async () => {
    mockApi();
    await renderPage();

    const table = await screen.findByRole("table", { name: "Test runs" });
    expect(
      await within(table).findByText("Release 2.4 smoke")
    ).toBeInTheDocument();
    expect(within(table).getByText("Ad-hoc checkout")).toBeInTheDocument();

    // The screen always sends an explicit status, defaulting to open.
    expect(listRunCalls()[0]).toContain("status=open");
  });

  it("maps the columns: plan name, status bar, % complete, assignees, start and due date", async () => {
    mockApi();
    await renderPage();

    const table = await screen.findByRole("table", { name: "Test runs" });

    // Plan ids resolve to names via GET /plans; a run with no plan shows —.
    expect(await within(table).findByText("Release 2.4")).toBeInTheDocument();
    expect(within(table).getAllByText("—").length).toBeGreaterThan(0);

    // Counts are surfaced as a StatusBar and a percentage.
    expect(
      within(table).getByRole("img", { name: /Release 2.4 smoke:/ })
    ).toBeInTheDocument();
    expect(within(table).getAllByText("75%").length).toBe(1);

    // The assignee column is a count (the contract only returns ids).
    expect(within(table).getByText("2 assignees")).toBeInTheDocument();
    expect(within(table).getByText("No items")).toBeInTheDocument();

    // Start and due dates are plain YYYY-MM-DD rendered without a day shift,
    // and Start date sits immediately before Due date.
    expect(within(table).getByText("1 Nov 2026")).toBeInTheDocument();
    expect(within(table).getByText("14 Nov 2026")).toBeInTheDocument();
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent?.trim() ?? "");
    const startIndex = headers.findIndex((header) => header.includes("Start date"));
    const dueIndex = headers.findIndex((header) => header.includes("Due date"));
    expect(startIndex).toBeGreaterThan(-1);
    expect(dueIndex).toBe(startIndex + 1);
  });

  it("shows an em dash in Start date when the run has none", async () => {
    mockApi();
    await renderPage();

    const table = await screen.findByRole("table", { name: "Test runs" });
    await within(table).findByText("Release 2.4");

    const startIndex = within(table)
      .getAllByRole("columnheader")
      .findIndex((cell) => cell.textContent?.includes("Start date"));

    const row = screen.getByText("Ad-hoc checkout").closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getAllByRole("cell")[startIndex]).toHaveTextContent(
      "—"
    );
  });

  it("switches the Open/Completed filter through the URL", async () => {
    mockApi();
    await renderPage();
    await screen.findByRole("table", { name: "Test runs" });

    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "completed" },
    });

    await waitFor(() =>
      expect(lastReplaceUrl()).toContain("status=completed")
    );
  });

  it("debounces search into the ?query= param", async () => {
    mockApi();
    await renderPage();
    await screen.findByRole("table", { name: "Test runs" });

    fireEvent.change(screen.getByLabelText("Search by name"), {
      target: { value: "release" },
    });

    await waitFor(
      () => expect(lastReplaceUrl()).toContain("query=release"),
      { timeout: 1500 }
    );
  });

  it("sorts by due date through the ?sort= param", async () => {
    mockApi();
    await renderPage();
    const table = await screen.findByRole("table", { name: "Test runs" });

    await within(table).findByText("Release 2.4 smoke");
    fireEvent.click(within(table).getByRole("button", { name: /Due date/ }));

    await waitFor(() => expect(lastReplaceUrl()).toContain("sort=due_date"));
  });

  it("sorts by start date through the ?sort= param", async () => {
    mockApi();
    await renderPage();
    const table = await screen.findByRole("table", { name: "Test runs" });

    await within(table).findByText("Release 2.4 smoke");
    fireEvent.click(within(table).getByRole("button", { name: /Start date/ }));

    await waitFor(() => expect(lastReplaceUrl()).toContain("sort=start_date"));
  });

  it("opens a run from its name", async () => {
    mockApi();
    await renderPage();
    const table = await screen.findByRole("table", { name: "Test runs" });

    fireEvent.click(
      await within(table).findByRole("button", {
        name: "Open run Release 2.4 smoke",
      })
    );

    expect(mockRouterState.push).toHaveBeenCalledWith("/runs/r-1?project=p-1");
  });

  it("opens a plan from the Plan column", async () => {
    mockApi();
    await renderPage();
    const table = await screen.findByRole("table", { name: "Test runs" });

    // With the plans list gone, this cell is the way into a plan's detail.
    fireEvent.click(
      await within(table).findByRole("button", { name: "Open plan Release 2.4" })
    );

    expect(mockRouterState.push).toHaveBeenCalledWith("/plans/pl-1?project=p-1");
  });

  it("creates a run and opens it", async () => {
    mockApi();
    await renderPage();
    await screen.findByRole("table", { name: "Test runs" });
    await screen.findByText("Release 2.4 smoke");

    fireEvent.click(screen.getByRole("button", { name: "New run" }));
    const dialog = await screen.findByRole("dialog", { name: "New run" });
    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "Checkout smoke" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create run" }));

    const post = await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) =>
          /\/projects\/[\w-]+\/runs$/.test(String(url)) &&
          init?.method === "POST"
      );
      expect(call).toBeTruthy();
      return call!;
    });
    expect(JSON.parse(post[1]?.body as string)).toEqual({
      name: "Checkout smoke",
    });
    await waitFor(() =>
      expect(mockRouterState.push).toHaveBeenCalledWith(
        "/runs/r-new?project=p-1"
      )
    );
  });

  it("posts the start and due dates when both are filled in", async () => {
    mockApi();
    await renderPage();
    await screen.findByRole("table", { name: "Test runs" });
    await screen.findByText("Release 2.4 smoke");

    fireEvent.click(screen.getByRole("button", { name: "New run" }));
    const dialog = await screen.findByRole("dialog", { name: "New run" });
    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "Checkout smoke" },
    });
    fireEvent.change(within(dialog).getByLabelText("Start date"), {
      target: { value: "2026-11-01" },
    });
    fireEvent.change(within(dialog).getByLabelText("Due date"), {
      target: { value: "2026-11-14" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create run" }));

    const post = await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) =>
          /\/projects\/[\w-]+\/runs$/.test(String(url)) &&
          init?.method === "POST"
      );
      expect(call).toBeTruthy();
      return call!;
    });
    expect(JSON.parse(post[1]?.body as string)).toEqual({
      name: "Checkout smoke",
      start_date: "2026-11-01",
      due_date: "2026-11-14",
    });
  });

  it("shows a server start_date error on the Start date field", async () => {
    mockApi({ createError: "start_date" });
    await renderPage();
    await screen.findByRole("table", { name: "Test runs" });
    await screen.findByText("Release 2.4 smoke");

    fireEvent.click(screen.getByRole("button", { name: "New run" }));
    const dialog = await screen.findByRole("dialog", { name: "New run" });
    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "Checkout smoke" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create run" }));

    expect(
      await screen.findByText("must be on or before due_date")
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Start date")).toHaveAttribute(
      "aria-invalid",
      "true"
    );
    expect(mockRouterState.push).not.toHaveBeenCalled();
  });

  it("shows a server field error on a failed create", async () => {
    mockApi({ createError: true });
    await renderPage();
    await screen.findByRole("table", { name: "Test runs" });
    await screen.findByText("Release 2.4 smoke");

    fireEvent.click(screen.getByRole("button", { name: "New run" }));
    const dialog = await screen.findByRole("dialog", { name: "New run" });
    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "Checkout smoke" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create run" }));

    expect(await screen.findByText("Name is required.")).toBeInTheDocument();
    expect(mockRouterState.push).not.toHaveBeenCalled();
  });

  it("shows a duplicate run name conflict on the Name field", async () => {
    mockApi({ createError: "conflict" });
    await renderPage();
    await screen.findByRole("table", { name: "Test runs" });
    await screen.findByText("Release 2.4 smoke");

    fireEvent.click(screen.getByRole("button", { name: "New run" }));
    const dialog = await screen.findByRole("dialog", { name: "New run" });
    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "Release 2.4 smoke" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create run" }));

    // A 409 names the field too, so the message lands on the input, not only
    // in the dialog's form-level error.
    expect(await screen.findByText("already in use")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Name")).toHaveAttribute(
      "aria-invalid",
      "true"
    );
    expect(
      within(dialog).queryByText("A run with this name already exists.")
    ).not.toBeInTheDocument();
    expect(mockRouterState.push).not.toHaveBeenCalled();
  });

  it("creates a plan together with its run, refreshes both lists and stays put", async () => {
    mockApi();
    await renderPage();
    await screen.findByRole("table", { name: "Test runs" });
    await screen.findByText("Release 2.4 smoke");

    fireEvent.click(screen.getByRole("button", { name: "New plan" }));
    const dialog = await screen.findByRole("dialog", { name: "New plan" });

    // Plan fields are labelled apart from a run's, so "Name" stays unambiguous.
    fireEvent.change(within(dialog).getByLabelText("Plan name"), {
      target: { value: "Release 2.5" },
    });
    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "Release 2.5 smoke" },
    });
    fireEvent.change(within(dialog).getByLabelText("Start date"), {
      target: { value: "2026-11-20" },
    });

    const plansBefore = listPlanCalls().length;
    const runsBefore = listRunCalls().length;

    fireEvent.click(within(dialog).getByRole("button", { name: "Create plan" }));

    await waitFor(() => expect(planPosts()).toHaveLength(1));
    expect(planPosts()[0]?.body).toEqual({
      name: "Release 2.5",
      description: null,
      due_date: null,
      runs: [{ name: "Release 2.5 smoke", start_date: "2026-11-20" }],
    });

    // The new plan feeds the Plan column and the run picker; the new run is a
    // row on this screen. A plan detail page would be a second step, not the
    // point of creating it, so nothing navigates.
    await waitFor(() => expect(listPlanCalls().length).toBeGreaterThan(plansBefore));
    await waitFor(() => expect(listRunCalls().length).toBeGreaterThan(runsBefore));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "New plan" })).toBeNull()
    );
    expect(mockRouterState.push).not.toHaveBeenCalled();
  });

  it("shows a server error keyed to the run inside the New plan dialog", async () => {
    mockApi({ planCreateError: "runs[0].name" });
    await renderPage();
    await screen.findByRole("table", { name: "Test runs" });
    await screen.findByText("Release 2.4 smoke");

    fireEvent.click(screen.getByRole("button", { name: "New plan" }));
    const dialog = await screen.findByRole("dialog", { name: "New plan" });
    fireEvent.change(within(dialog).getByLabelText("Plan name"), {
      target: { value: "Release 2.5" },
    });
    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "Release 2.5 smoke" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create plan" }));

    expect(await screen.findByText("Run name is required.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Name")).toHaveAttribute(
      "aria-invalid",
      "true"
    );
    expect(mockRouterState.push).not.toHaveBeenCalled();
  });
});

describe("roles and archived projects", () => {
  it("a viewer gets a read-only list with no New run button", async () => {
    mockApi({ role: "viewer" });
    await renderPage();
    await screen.findByRole("table", { name: "Test runs" });

    expect(screen.queryByRole("button", { name: "New run" })).toBeNull();
    expect(screen.queryByRole("button", { name: "New plan" })).toBeNull();
    expect(
      screen.getByText(/needs the Admin or Lead role/)
    ).toBeInTheDocument();
  });

  it("an archived project is read-only for everyone, including admins", async () => {
    mockApi({ project: ARCHIVED });
    await renderPage();
    await screen.findByRole("table", { name: "Test runs" });

    expect(screen.queryByRole("button", { name: "New run" })).toBeNull();
    expect(screen.queryByRole("button", { name: "New plan" })).toBeNull();
    expect(
      screen.getByText(/This project is archived/)
    ).toBeInTheDocument();
  });
});

describe("project resolution", () => {
  it("resolves the first project and writes it to the URL when none is given", async () => {
    mockRouterState.search = "";
    mockApi();
    await renderPage();

    await waitFor(() =>
      expect(mockRouterState.replace).toHaveBeenCalledWith(
        expect.stringContaining("project=p-1"),
        expect.anything()
      )
    );
    // It falls back to the projects list, not a project-scoped endpoint.
    expect(
      fetchMock.mock.calls.some(([url]) => /\/projects(\?|$)/.test(String(url)))
    ).toBe(true);
  });
});