import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import type { Plan, Project, Role, User } from "@/lib/api-types";

/**
 * Plans list (card 3.3). Covers the behaviour the primitives do not own: the
 * rollup columns, the create/edit calls, the delete confirmation that promises
 * the runs are kept (PRD decision 7), and the role/archived gating.
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
  usePathname: () => "/plans",
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(mockRouterState.search),
}));

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function emptyResponse(status: number): Response {
  return new Response(null, { status });
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

const EMPTY_PLAN: Plan = {
  ...PLAN,
  id: "pl-2",
  name: "Fresh plan",
  due_date: null,
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
};

const calls = {
  create: [] as unknown[],
  update: [] as unknown[],
  del: [] as string[],
};

interface ApiOptions {
  role?: Role;
  project?: Project;
  plans?: Plan[];
}

let fetchMock: jest.Mock;

function mockApi({
  role = "admin",
  project = PROJECT,
  plans = [PLAN, EMPTY_PLAN],
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
      if (/\/projects\/[\w-]+\/plans(\?|$)/.test(target) && method === "POST") {
        calls.create.push(JSON.parse(init?.body ?? "{}"));
        return Promise.resolve(jsonResponse(201, { data: EMPTY_PLAN }));
      }
      if (/\/plans\/[\w-]+$/.test(target) && method === "PATCH") {
        calls.update.push({ url: target, body: JSON.parse(init?.body ?? "{}") });
        return Promise.resolve(jsonResponse(200, { data: PLAN }));
      }
      if (/\/plans\/[\w-]+$/.test(target) && method === "DELETE") {
        calls.del.push(target);
        return Promise.resolve(emptyResponse(204));
      }
      if (/\/projects\/[\w-]+\/plans(\?|$)/.test(target) && method === "GET") {
        return Promise.resolve(
          jsonResponse(200, {
            data: plans,
            meta: { page: 1, limit: 25, total: plans.length, total_pages: 1 },
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
  const { default: PlansPage } = await import("@/app/(app)/plans/page");
  const { RequireAuth } = await import("@/components/require-auth");
  const { SessionProvider } = await import("@/lib/session");
  return render(
    <SessionProvider>
      <RequireAuth>
        <PlansPage />
      </RequireAuth>
    </SessionProvider>
  );
}

function lastReplaceUrl(): string {
  const list = mockRouterState.replace.mock.calls;
  return String(list[list.length - 1]?.[0] ?? "");
}

function planListCalls(): string[] {
  return fetchMock.mock.calls
    .map(([url, init]) => ({ url: String(url), init }))
    .filter(
      ({ url, init }) =>
        /\/projects\/[\w-]+\/plans(\?|$)/.test(url) &&
        (init?.method ?? "GET") === "GET"
    )
    .map(({ url }) => url);
}

beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  mockRouterState.search = "project=p-1";
  mockRouterState.replace = jest.fn();
  mockRouterState.push = jest.fn();
  calls.create = [];
  calls.update = [];
  calls.del = [];
});

describe("plans screen", () => {
  it("renders the rollup columns and asks for the newest first", async () => {
    mockApi();
    await renderPage();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Test plans" })
    ).toBeInTheDocument();
    const table = await screen.findByRole("table", { name: "Test plans" });
    await within(table).findByText("Release 2.4");

    expect(
      within(table).getByRole("button", { name: "Open plan Release 2.4" })
    ).toBeInTheDocument();
    expect(within(table).getByText("63%")).toBeInTheDocument();
    expect(within(table).getByText("No runs")).toBeInTheDocument();
    expect(within(table).getByText("14 Nov 2026")).toBeInTheDocument();
    expect(planListCalls()[0]).toContain("sort=-created_at");
  });

  it("opens a plan through the URL", async () => {
    mockApi();
    await renderPage();

    const table = await screen.findByRole("table", { name: "Test plans" });
    await within(table).findByText("Release 2.4");
    fireEvent.click(
      within(table).getByRole("button", { name: "Open plan Release 2.4" })
    );

    expect(mockRouterState.push).toHaveBeenCalledWith("/plans/pl-1?project=p-1");
  });

  it("creates a plan and refetches the list", async () => {
    mockApi();
    await renderPage();
    await screen.findByRole("table", { name: "Test plans" });
    const before = planListCalls().length;

    fireEvent.click(screen.getByRole("button", { name: "New plan" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Release 2.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create plan" }));

    await waitFor(() =>
      expect(calls.create).toEqual([
        { name: "Release 2.5", description: null, due_date: null },
      ])
    );
    await waitFor(() => expect(planListCalls().length).toBeGreaterThan(before));
  });

  it("edits a plan with all three fields", async () => {
    mockApi();
    await renderPage();
    const table = await screen.findByRole("table", { name: "Test plans" });
    await within(table).findByText("Release 2.4");

    fireEvent.click(
      within(table).getByRole("button", { name: "Edit plan Release 2.4" })
    );
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Release 2.4 (final)" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));

    await waitFor(() => expect(calls.update).toHaveLength(1));
    expect(calls.update[0]).toEqual({
      url: expect.stringContaining("/plans/pl-1"),
      body: {
        name: "Release 2.4 (final)",
        description: null,
        due_date: "2026-11-14",
      },
    });
  });

  it("warns that deleting a plan keeps its runs", async () => {
    mockApi();
    await renderPage();
    const table = await screen.findByRole("table", { name: "Test plans" });
    await within(table).findByText("Release 2.4");

    fireEvent.click(
      within(table).getByRole("button", { name: "Delete plan Release 2.4" })
    );

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Delete “Release 2.4”?");
    expect(dialog).toHaveTextContent("Its runs are kept");

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete plan" }));
    await waitFor(() =>
      expect(calls.del[0]).toContain("/plans/pl-1")
    );
  });

  it("hides every write control from a Viewer", async () => {
    mockApi({ role: "viewer" });
    await renderPage();

    const table = await screen.findByRole("table", { name: "Test plans" });
    await within(table).findByText("Release 2.4");
    expect(
      screen.getByText(
        "Read-only: creating or editing plans needs the Admin or Lead role."
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New plan" })).toBeNull();
    expect(
      within(table).queryByRole("button", { name: /Edit plan/ })
    ).toBeNull();
    expect(
      within(table).queryByRole("button", { name: /Delete plan/ })
    ).toBeNull();
  });

  it("tells a Lead the plans are read-only while the project is archived", async () => {
    mockApi({ role: "lead", project: ARCHIVED });
    await renderPage();

    await screen.findByRole("table", { name: "Test plans" });
    await screen.findByText("Release 2.4");
    expect(
      screen.getByText("This project is archived. Test plans are read-only.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New plan" })).toBeNull();
  });

  it("debounces the search into the URL", async () => {
    mockApi();
    await renderPage();
    await screen.findByRole("table", { name: "Test plans" });

    fireEvent.change(screen.getByLabelText("Search by name"), {
      target: { value: "release" },
    });

    await waitFor(() => expect(lastReplaceUrl()).toContain("query=release"), {
      timeout: 2000,
    });
  });
});