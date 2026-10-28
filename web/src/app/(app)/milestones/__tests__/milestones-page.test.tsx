import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Milestone, Project, Role, User } from "@/lib/api-types";
import { formatDaysLeft } from "@/lib/dates";

/**
 * Milestones list (docs/DESIGN.md §4.5, docs/backlog-slice4-milestones.md card
 * 3.1). Covers what the primitives do not own: the All-statuses/due-date
 * defaults in the URL, the derived columns (runs, status, % complete, days
 * left), the create/edit/delete round trip, the server's duplicate-name error
 * on the Name field, and the Admin/Lead + archived read-only rules.
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
  usePathname: () => "/milestones",
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

function milestone(
  overrides: Partial<Milestone> & { id: string; name: string }
): Milestone {
  return {
    project_id: "p-1",
    description: null,
    due_date: null,
    status: "open",
    run_count: 0,
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
    created_by: "u-1",
    updated_by: "u-1",
    created_at: "2026-10-20T12:00:00Z",
    updated_at: "2026-10-20T12:00:00Z",
    ...overrides,
  };
}

const OPEN_WITH_RUNS = milestone({
  id: "m-1",
  name: "2.4 release",
  description: "Ship 2.4",
  due_date: "2026-11-14",
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
});

const EMPTY_UNDATED = milestone({ id: "m-2", name: "Q1 hardening" });

const COMPLETED = milestone({
  id: "m-3",
  name: "2.3 release",
  due_date: "2026-10-01",
  status: "completed",
  run_count: 1,
  counts: {
    total: 4,
    passed: 4,
    failed: 0,
    blocked: 0,
    retest: 0,
    skipped: 0,
    untested: 0,
    percent_complete: 100,
  },
});

const ROWS = [OPEN_WITH_RUNS, EMPTY_UNDATED, COMPLETED];

let fetchMock: jest.Mock;

interface ApiOptions {
  role?: Role;
  project?: Project;
  milestones?: Milestone[];
  meta?: { page: number; limit: number; total: number; total_pages: number };
  /** Duplicate name: a 409 on create, keyed to the Name field. */
  duplicateName?: boolean;
}

function mockApi({
  role = "admin",
  project = PROJECT,
  milestones = ROWS,
  meta,
  duplicateName = false,
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
      if (
        /\/projects\/[\w-]+\/milestones$/.test(target) &&
        method === "POST"
      ) {
        if (duplicateName) {
          return Promise.resolve(
            jsonResponse(409, {
              error: {
                code: "CONFLICT",
                message: "A milestone with this name already exists.",
                details: [
                  {
                    field: "name",
                    issue: "A milestone with this name already exists.",
                  },
                ],
              },
            })
          );
        }
        const body = JSON.parse(init?.body ?? "{}") as { name: string };
        return Promise.resolve(
          jsonResponse(201, { data: milestone({ id: "m-new", name: body.name }) })
        );
      }
      if (/\/milestones\/[\w-]+$/.test(target) && method === "PATCH") {
        return Promise.resolve(
          jsonResponse(200, {
            data: { ...OPEN_WITH_RUNS, ...JSON.parse(init?.body ?? "{}") },
          })
        );
      }
      if (/\/milestones\/[\w-]+$/.test(target) && method === "DELETE") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (
        /\/projects\/[\w-]+\/milestones(\?|$)/.test(target) &&
        method === "GET"
      ) {
        return Promise.resolve(
          jsonResponse(200, {
            data: milestones,
            meta:
              meta ?? {
                page: 1,
                limit: 25,
                total: milestones.length,
                total_pages: 1,
              },
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
  const { default: MilestonesPage } = await import(
    "@/app/(app)/milestones/page"
  );
  const { RequireAuth } = await import("@/components/require-auth");
  const { SessionProvider } = await import("@/lib/session");
  return render(
    <SessionProvider>
      <RequireAuth>
        <MilestonesPage />
      </RequireAuth>
    </SessionProvider>
  );
}

function listMilestoneCalls(): string[] {
  return fetchMock.mock.calls
    .map(([url, init]) => ({ url: String(url), init }))
    .filter(
      ({ url, init }) =>
        /\/projects\/[\w-]+\/milestones(\?|$)/.test(url) &&
        (init?.method ?? "GET") === "GET"
    )
    .map(({ url }) => url);
}

function lastReplaceUrl(): string {
  const calls = mockRouterState.replace.mock.calls;
  return String(calls[calls.length - 1]?.[0] ?? "");
}

function table(): Promise<HTMLElement> {
  return screen.findByRole("table", { name: "Milestones" });
}

beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  mockRouterState.search = "project=p-1";
  mockRouterState.replace = jest.fn();
  mockRouterState.push = jest.fn();
});

describe("milestones list", () => {
  it("loads with All statuses and due-date order, without putting either in the URL", async () => {
    mockApi();
    await renderPage();

    const grid = await table();
    expect(await within(grid).findByText("2.4 release")).toBeInTheDocument();
    expect(within(grid).getByText("Q1 hardening")).toBeInTheDocument();

    const url = listMilestoneCalls()[0] ?? "";
    expect(url).toContain("sort=due_date");
    expect(url).not.toContain("status=");
  });

  it("maps the derived columns: runs, status, % complete and days left", async () => {
    mockApi();
    await renderPage();

    const grid = await table();
    await within(grid).findByText("2.4 release");

    const headers = within(grid)
      .getAllByRole("columnheader")
      .map((cell) =>
        // Sortable headers append the direction glyph and its spoken label.
        (cell.textContent ?? "").replace(/[↕▲▼][\s\S]*$/, "").trim()
      );
    expect(headers).toEqual([
      "Name",
      "Runs",
      "Status",
      "% complete",
      "Due date",
      "Days left",
      "Actions",
    ]);

    const openRow = screen.getByText("2.4 release").closest("tr") as HTMLElement;
    expect(within(openRow).getByText("2")).toBeInTheDocument(); // run count
    expect(within(openRow).getByText("Open")).toBeInTheDocument();
    // The status bar carries the exact counts in one image label.
    expect(within(openRow).getByRole("img", { name: /2\.4 release:/ })).toBeInTheDocument();
    expect(within(openRow).getByText("63%")).toBeInTheDocument();
    expect(within(openRow).getByText("14 Nov 2026")).toBeInTheDocument();
    // Days left is the web's own copy, always derived from the due date.
    expect(
      within(openRow).getByText(formatDaysLeft("2026-11-14") as string)
    ).toBeInTheDocument();

    // An empty milestone reads "No runs" rather than an empty bar, and an
    // undated one shows em dashes for both date columns.
    const emptyRow = screen.getByText("Q1 hardening").closest("tr") as HTMLElement;
    expect(within(emptyRow).getByText("No runs")).toBeInTheDocument();
    expect(within(emptyRow).getAllByText("—")).toHaveLength(2);

    const doneRow = screen.getByText("2.3 release").closest("tr") as HTMLElement;
    expect(within(doneRow).getByText("Completed")).toBeInTheDocument();
    expect(within(doneRow).getByText("100%")).toBeInTheDocument();
  });

  it("opens a milestone from its name", async () => {
    mockApi();
    await renderPage();
    const grid = await table();

    fireEvent.click(
      await within(grid).findByRole("button", { name: "Open milestone 2.4 release" })
    );
    expect(mockRouterState.push).toHaveBeenLastCalledWith(
      "/milestones/m-1?project=p-1"
    );
  });

  it("filters by status through the URL and refetches", async () => {
    mockApi();
    await renderPage();
    await table();

    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "completed" },
    });

    await waitFor(() => expect(lastReplaceUrl()).toContain("status=completed"));
  });

  it("debounces the name search into ?query=", async () => {
    mockApi();
    await renderPage();
    await table();

    fireEvent.change(screen.getByLabelText("Search by name"), {
      target: { value: "release" },
    });

    await waitFor(() => expect(lastReplaceUrl()).toContain("query=release"), {
      timeout: 1500,
    });
  });

  it("sorts by name through ?sort=", async () => {
    mockApi();
    await renderPage();
    const grid = await table();
    await within(grid).findByText("2.4 release");

    fireEvent.click(within(grid).getByRole("button", { name: /^Name/ }));
    await waitFor(() => expect(lastReplaceUrl()).toContain("sort=name"));
  });

  it("creates a milestone from its three fields and reloads the list", async () => {
    mockApi();
    await renderPage();
    await table();

    fireEvent.click(screen.getByRole("button", { name: "New milestone" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "  2.5 release  " },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: " Holiday freeze " },
    });
    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "2026-12-20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create milestone" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, init]) =>
          /\/projects\/[\w-]+\/milestones$/.test(String(url)) &&
          init?.method === "POST"
      );
      expect(post).toBeDefined();
      expect(JSON.parse(post?.[1]?.body as string)).toEqual({
        name: "2.5 release",
        description: "Holiday freeze",
        due_date: "2026-12-20",
      });
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(listMilestoneCalls().length).toBeGreaterThan(1));
  });

  it("sends null for an emptied description and due date", async () => {
    mockApi();
    await renderPage();
    await table();

    fireEvent.click(screen.getByRole("button", { name: "New milestone" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "2.5 release" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create milestone" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, init]) =>
          /\/projects\/[\w-]+\/milestones$/.test(String(url)) &&
          init?.method === "POST"
      );
      expect(JSON.parse(post?.[1]?.body as string)).toEqual({
        name: "2.5 release",
        description: null,
        due_date: null,
      });
    });
  });

  it("shows a duplicate name on the Name field and keeps the dialog open", async () => {
    mockApi({ duplicateName: true });
    await renderPage();
    await table();

    fireEvent.click(screen.getByRole("button", { name: "New milestone" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "2.4 release" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create milestone" }));

    expect(
      await screen.findByText("A milestone with this name already exists.")
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveAttribute(
      "aria-invalid",
      "true"
    );
  });

  it("edits a milestone from its row action", async () => {
    mockApi();
    await renderPage();
    const grid = await table();
    await within(grid).findByText("2.4 release");

    fireEvent.click(
      within(grid).getByRole("button", { name: "Edit 2.4 release" })
    );
    expect(screen.getByRole("button", { name: "Save milestone" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("2.4 release");

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "2.4 release (final)" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save milestone" }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).endsWith("/milestones/m-1") && init?.method === "PATCH"
      );
      expect(patch).toBeDefined();
      expect(JSON.parse(patch?.[1]?.body as string)).toEqual({
        name: "2.4 release (final)",
        description: "Ship 2.4",
        due_date: "2026-11-14",
      });
    });
  });

  it("deletes a milestone after confirmation and says its runs survive", async () => {
    mockApi();
    await renderPage();
    const grid = await table();
    await within(grid).findByText("2.4 release");

    fireEvent.click(
      within(grid).getByRole("button", { name: "Delete 2.4 release" })
    );
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("Its 2 runs will be kept, without a milestone.");
    expect(dialog).toHaveTextContent("No run, result or attachment is deleted.");

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete milestone" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith("/milestones/m-1") &&
            init?.method === "DELETE"
        )
      ).toBe(true)
    );
    await waitFor(() => expect(listMilestoneCalls().length).toBeGreaterThan(1));
  });

  it("shows the primary action in the empty state for an empty project", async () => {
    mockApi({ milestones: [] });
    await renderPage();

    expect(
      await screen.findByText("No milestones in Payments.")
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "A milestone is a dated checkpoint over runs. Create it first, then add its runs."
      )
    ).toBeInTheDocument();
    const newButtons = screen.getAllByRole("button", { name: "New milestone" });
    expect(newButtons.length).toBeGreaterThan(0);
  });

  it("offers Clear filters when the empty list is filtered", async () => {
    mockRouterState.search = "project=p-1&query=beta&status=completed";
    mockApi({ milestones: [] });
    await renderPage();

    expect(
      await screen.findByText("No milestones match your filters.")
    ).toBeInTheDocument();
    const url = listMilestoneCalls()[0] ?? "";
    expect(url).toContain("query=beta");
    expect(url).toContain("status=completed");

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    const next = lastReplaceUrl();
    expect(next).not.toContain("query=");
    expect(next).not.toContain("status=");
  });

  it("pages through the list through ?page=", async () => {
    mockApi({
      meta: { page: 1, limit: 25, total: 30, total_pages: 2 },
    });
    await renderPage();
    await table();

    const nav = await screen.findByRole("navigation", {
      name: "Milestone list pages",
    });
    expect(nav).toHaveTextContent("Page 1 of 2 (30 milestones)");

    fireEvent.click(within(nav).getByRole("button", { name: "Next" }));
    await waitFor(() => expect(lastReplaceUrl()).toContain("page=2"));
  });

  it("hides every write action from a Tester", async () => {
    mockApi({ role: "tester" });
    await renderPage();
    const grid = await table();
    await within(grid).findByText("2.4 release");

    expect(
      screen.getByText(
        "Read-only: creating or editing milestones needs the Admin or Lead role."
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "New milestone" })
    ).toBeNull();
    expect(
      within(grid).queryByRole("button", { name: "Edit 2.4 release" })
    ).toBeNull();
    expect(
      within(grid).queryByRole("columnheader", { name: "Actions" })
    ).toBeNull();
  });

  it("is read-only for everyone when the project is archived", async () => {
    mockApi({ project: ARCHIVED });
    await renderPage();
    await table();

    expect(
      screen.getByText("This project is archived. Milestones are read-only.")
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "New milestone" })
    ).toBeNull();
  });
});

describe("?new=1 deep link from the project overview", () => {
  it("opens the New milestone dialog once for a writer, then strips the param", async () => {
    mockRouterState.search = "project=p-1&new=1";
    mockApi();
    await renderPage();

    expect(
      await screen.findByRole("dialog", { name: "New milestone" })
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(lastReplaceUrl()).toBe("/milestones?project=p-1")
    );
  });

  it("leaves a Tester on the ordinary list and never strips anything", async () => {
    mockRouterState.search = "project=p-1&new=1";
    mockApi({ role: "tester" });
    await renderPage();
    await table();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mockRouterState.replace).not.toHaveBeenCalled();
  });
});