import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import type {
  CaseDetail,
  CaseHistoryEntry,
  CaseListItem,
  Project,
  Role,
  SuiteNode,
  User,
} from "@/lib/api-types";

/**
 * Two-pane test cases screen (card 3.2). Covers the behaviour that is not
 * already owned by a primitive: suite-scoped loading, URL-as-state for
 * filters/drawer, the bulk bar, role read-only rules, the archived banner and
 * the drawer's History tab.
 */

const mockRouterState = {
  search: "",
  replace: jest.fn(),
};

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockRouterState.replace,
    push: jest.fn(),
    back: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => "/cases",
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

function suite(overrides: Partial<SuiteNode> & { id: string; name: string }): SuiteNode {
  return {
    project_id: "p-1",
    parent_id: null,
    description: null,
    depth: 1,
    position: 1,
    case_count: 0,
    created_by: "u-1",
    created_at: "2026-10-25T09:00:00Z",
    updated_at: "2026-10-25T09:00:00Z",
    children: [],
    ...overrides,
  };
}

const SUITES: SuiteNode[] = [
  suite({
    id: "s-1",
    name: "Checkout",
    case_count: 2,
    children: [
      suite({
        id: "s-2",
        parent_id: "s-1",
        name: "Payments",
        depth: 2,
        case_count: 1,
      }),
    ],
  }),
  suite({ id: "s-3", name: "Account", position: 2, case_count: 0 }),
];

function listItem(overrides: Partial<CaseListItem> = {}): CaseListItem {
  return {
    id: "c-1",
    project_id: "p-1",
    suite_id: "s-1",
    case_number: 1,
    display_id: "C1",
    title: "Pay with a saved card",
    priority: "high",
    type: "functional",
    tags: ["payments", "smoke"],
    estimate_minutes: 15,
    created_by: "u-1",
    updated_by: "u-1",
    created_at: "2026-10-25T09:00:00Z",
    updated_at: "2026-10-25T09:12:00Z",
    step_count: 2,
    ...overrides,
  };
}

const ROWS: CaseListItem[] = [
  listItem(),
  listItem({
    id: "c-2",
    case_number: 2,
    display_id: "C2",
    title: "Refund the order",
    priority: "medium",
    tags: ["refunds"],
    step_count: 1,
  }),
];

const DETAIL: CaseDetail = {
  id: "c-1",
  project_id: "p-1",
  suite_id: "s-1",
  case_number: 1,
  display_id: "C1",
  title: "Pay with a saved card",
  preconditions: "Customer has a saved card",
  steps: [
    { position: 1, text: "Open checkout", expected_result: "Cart total is shown" },
    { position: 2, text: "Pay", expected_result: null },
  ],
  priority: "high",
  type: "functional",
  tags: ["payments", "smoke"],
  estimate_minutes: 15,
  created_by: "u-1",
  updated_by: "u-1",
  created_at: "2026-10-25T09:00:00Z",
  updated_at: "2026-10-25T09:12:00Z",
};

const HISTORY: CaseHistoryEntry[] = [
  {
    id: "h-1",
    case_id: "c-1",
    actor_id: "u-1",
    action: "updated",
    changes: { priority: { from: "medium", to: "high" } },
    created_at: "2026-10-25T09:12:00Z",
  },
];

let fetchMock: jest.Mock;

interface ApiOptions {
  role?: Role;
  project?: Project;
  cases?: CaseListItem[];
  /** Make the bulk-move POST fail with a 500 so the error banner shows. */
  bulkMoveError?: boolean;
}

function mockApi({
  role = "admin",
  project = PROJECT,
  cases = ROWS,
  bulkMoveError = false,
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
      if (target.includes("/cases/bulk-move") && method === "POST") {
        if (bulkMoveError) {
          return Promise.resolve(
            jsonResponse(500, {
              error: { code: "INTERNAL", message: "Something went wrong." },
            })
          );
        }
        const body = JSON.parse(init?.body ?? "{}") as { case_ids: string[] };
        return Promise.resolve(
          jsonResponse(200, { data: { moved: body.case_ids.length, case_ids: body.case_ids } })
        );
      }
      if (/\/cases\/[\w-]+\/history/.test(target) && method === "GET") {
        return Promise.resolve(
          jsonResponse(200, {
            data: HISTORY,
            meta: { page: 1, limit: 25, total: HISTORY.length, total_pages: 1 },
          })
        );
      }
      if (/\/cases\/[\w-]+$/.test(target) && method === "GET") {
        return Promise.resolve(jsonResponse(200, { data: DETAIL }));
      }
      if (/\/projects\/[\w-]+\/suites$/.test(target) && method === "GET") {
        return Promise.resolve(jsonResponse(200, { data: SUITES }));
      }
      if (/\/projects\/[\w-]+\/cases(\?|$)/.test(target) && method === "GET") {
        return Promise.resolve(
          jsonResponse(200, {
            data: cases,
            meta: { page: 1, limit: 25, total: cases.length, total_pages: 1 },
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
  const { default: CasesPage } = await import("@/app/(app)/cases/page");
  const { RequireAuth } = await import("@/components/require-auth");
  const { SessionProvider } = await import("@/lib/session");
  return render(
    <SessionProvider>
      <RequireAuth>
        <CasesPage />
      </RequireAuth>
    </SessionProvider>
  );
}

function lastReplaceUrl(): string {
  const calls = mockRouterState.replace.mock.calls;
  return String(calls[calls.length - 1]?.[0] ?? "");
}

beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  mockRouterState.search = "project=p-1&suite=s-1";
  mockRouterState.replace = jest.fn();
});

describe("cases screen", () => {
  it("loads the suite-scoped case list and renders the tree, breadcrumb and rows", async () => {
    mockApi();
    await renderPage();

    const table = await screen.findByRole("table", { name: "Test cases" });
    await within(table).findByText("Pay with a saved card");
    expect(within(table).getByText("Refund the order")).toBeInTheDocument();
    expect(within(table).getByText("C1")).toBeInTheDocument();

    expect(
      screen.getByRole("tree", { name: "Test suites" })
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Test cases" })).toBeInTheDocument();
    // Project name in the breadcrumb and the same word on the suite row.
    expect(screen.getAllByText("Payments").length).toBeGreaterThan(0);
    expect(screen.getByText("2 cases")).toBeInTheDocument();

    const listUrl = String(
      fetchMock.mock.calls
        .map(([url]) => String(url))
        .find((url) => url.includes("/cases?")) ?? ""
    );
    expect(listUrl).toContain("suite_id=s-1");
    expect(listUrl).toContain("include_descendants=true");
  });

  it("opens the drawer from a row and closes it with Esc", async () => {
    mockApi();
    const first = await renderPage();

    const table = await screen.findByRole("table", { name: "Test cases" });
    fireEvent.click(
      await within(table).findByRole("button", {
        name: /Open C1: Pay with a saved card/,
      })
    );
    expect(lastReplaceUrl()).toContain("case=c-1");
    first.unmount();

    // The URL is the source of truth, so render that view directly.
    mockRouterState.search = "project=p-1&suite=s-1&case=c-1";
    await renderPage();

    const drawer = await screen.findByRole("dialog", { name: /C1/ });
    expect(within(drawer).getByText("Pay with a saved card")).toBeInTheDocument();
    expect(within(drawer).getByText("Open checkout")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(lastReplaceUrl()).not.toContain("case="));
  });

  it("opening a case closes the New case form instead of stacking drawers", async () => {
    mockApi();
    await renderPage();
    const table = await screen.findByRole("table", { name: "Test cases" });

    // Start the New case form (its own drawer in the same right-hand slot).
    fireEvent.click(screen.getByRole("button", { name: "Add case" }));
    expect(
      await screen.findByRole("dialog", { name: "New case" })
    ).toBeInTheDocument();

    // Clicking a row must close the form, not open a second overlapping drawer.
    fireEvent.click(
      await within(table).findByRole("button", {
        name: /Open C1: Pay with a saved card/,
      })
    );

    expect(screen.queryByRole("dialog", { name: "New case" })).toBeNull();
    expect(lastReplaceUrl()).toContain("case=c-1");
  });

  it("Add case clears the open case drawer (only one drawer at a time)", async () => {
    mockRouterState.search = "project=p-1&suite=s-1&case=c-1";
    mockApi();
    await renderPage();

    await screen.findByRole("dialog", { name: /C1/ });
    fireEvent.click(screen.getByRole("button", { name: "Add case" }));

    expect(
      await screen.findByRole("dialog", { name: "New case" })
    ).toBeInTheDocument();
    // The case drawer is URL-driven, so clearing `case=` is what removes it.
    expect(lastReplaceUrl()).not.toContain("case=");
  });

  it("renders the History tab without raw JSON", async () => {
    mockRouterState.search = "project=p-1&suite=s-1&case=c-1";
    mockApi();
    await renderPage();

    const drawer = await screen.findByRole("dialog", { name: /C1/ });
    fireEvent.click(within(drawer).getByRole("tab", { name: "History" }));

    expect(await within(drawer).findByText("Updated")).toBeInTheDocument();
    expect(within(drawer).getByText("Priority:")).toBeInTheDocument();
    expect(within(drawer).getByText(/medium → high/)).toBeInTheDocument();
  });

  it("writes filter changes to the URL", async () => {
    mockApi();
    await renderPage();
    await screen.findByRole("button", { name: /Open C1/ });

    fireEvent.click(screen.getByLabelText("High"));
    expect(lastReplaceUrl()).toContain("priority=high");
    expect(lastReplaceUrl()).not.toContain("page=");

    fireEvent.click(screen.getByLabelText("Smoke"));
    expect(lastReplaceUrl()).toContain("type=smoke");
  });

  it("moves the selected cases through the bulk bar", async () => {
    mockApi();
    await renderPage();
    await screen.findByRole("button", { name: /Open C1/ });

    fireEvent.click(screen.getByRole("checkbox", { name: "Select row 1" }));
    const bulk = screen.getByRole("region", { name: "Selected cases" });
    expect(bulk).toHaveTextContent("1 selected");

    fireEvent.click(within(bulk).getByRole("button", { name: "Move…" }));
    const dialog = screen.getByRole("dialog", { name: "Move cases" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Move cases" }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) =>
        String(url).includes("/cases/bulk-move")
      );
      expect(call).toBeDefined();
      expect(call?.[1] ?? {}).toMatchObject({ method: "POST" });
      expect(JSON.parse((call?.[1] as { body: string }).body)).toEqual({
        case_ids: ["c-1"],
        suite_id: "s-1",
      });
    });
    expect(await screen.findByRole("status")).toHaveTextContent("1 case moved.");
  });

  it("is read-only for a Tester", async () => {
    mockApi({ role: "tester" });
    await renderPage();

    expect(await screen.findByRole("button", { name: /Open C1/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add case" })).toBeNull();
    expect(
      screen.getByText(
        "Read-only: adding or editing cases needs the Admin or Lead role."
      )
    ).toBeInTheDocument();
  });

  it("is read-only for everyone on an archived project", async () => {
    mockApi({ project: { ...PROJECT, status: "archived" } });
    await renderPage();

    expect(await screen.findByRole("button", { name: /Open C1/ })).toBeInTheDocument();
    expect(
      screen.getByText("This project is archived. Cases and suites are read-only.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add case" })).toBeNull();
  });

  it("shows the empty state for a suite without cases", async () => {
    mockApi({ cases: [] });
    await renderPage();

    expect(
      await screen.findByText("No cases in Checkout.")
    ).toBeInTheDocument();
  });

  it("sorts the Priority column through the URL in both directions", async () => {
    mockApi();
    const first = await renderPage();
    await screen.findByRole("button", { name: /Open C1/ });
    const table = screen.getByRole("table", { name: "Test cases" });

    // First click sorts ascending by severity (critical first).
    fireEvent.click(within(table).getByRole("button", { name: "Priority" }));
    expect(lastReplaceUrl()).toContain("sort=priority");
    expect(lastReplaceUrl()).not.toContain("page=");
    first.unmount();

    // An ascending sort in the URL flips to descending on the next click.
    mockRouterState.search = "project=p-1&suite=s-1&sort=priority";
    await renderPage();
    await screen.findByRole("button", { name: /Open C1/ });
    const sortedTable = screen.getByRole("table", {
      name: "Test cases",
    });
    fireEvent.click(
      within(sortedTable).getByRole("button", {
        name: /Sorted ascending by Priority/,
      })
    );
    expect(lastReplaceUrl()).toContain("sort=-priority");
  });

  it("marks the Type and Updated columns for shrink-to-fit sizing", async () => {
    mockApi();
    await renderPage();
    await screen.findByRole("button", { name: /Open C1/ });
    const table = screen.getByRole("table", { name: "Test cases" });

    // DataTable applies col.className to both the th and the td, and cases.css
    // keys on these classes to size each column to its own value length rather
    // than letting the value wrap onto a second line.
    for (const cls of ["case-col-type", "case-col-updated"]) {
      expect(table.querySelector(`thead th.${cls}`)).not.toBeNull();
      expect(table.querySelector(`tbody td.${cls}`)).not.toBeNull();
    }
  });

  it("dismisses a success notification with its × button", async () => {
    mockApi();
    await renderPage();
    await screen.findByRole("button", { name: /Open C1/ });

    fireEvent.click(screen.getByRole("checkbox", { name: "Select row 1" }));
    const bulk = screen.getByRole("region", { name: "Selected cases" });
    fireEvent.click(within(bulk).getByRole("button", { name: "Move…" }));
    const dialog = screen.getByRole("dialog", { name: "Move cases" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Move cases" }));

    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent("1 case moved.");

    fireEvent.click(
      within(notice).getByRole("button", { name: "Dismiss notification" })
    );
    expect(screen.queryByText("1 case moved.")).toBeNull();
  });

  it("dismisses an action error with its × button", async () => {
    mockApi({ bulkMoveError: true });
    await renderPage();
    await screen.findByRole("button", { name: /Open C1/ });

    fireEvent.click(screen.getByRole("checkbox", { name: "Select row 1" }));
    const bulk = screen.getByRole("region", { name: "Selected cases" });
    fireEvent.click(within(bulk).getByRole("button", { name: "Move…" }));
    const dialog = screen.getByRole("dialog", { name: "Move cases" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Move cases" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong.");

    fireEvent.click(
      within(alert).getByRole("button", { name: "Dismiss error" })
    );
    expect(screen.queryByText("Something went wrong.")).toBeNull();
  });

  it("explains why a bulk action is disabled", async () => {
    mockApi({ role: "tester" });
    await renderPage();
    await screen.findByRole("button", { name: /Open C1/ });

    fireEvent.click(screen.getByRole("checkbox", { name: "Select row 1" }));
    const move = screen.getByRole("button", { name: "Move…" });
    expect(move).toBeDisabled();
    expect(move.closest(".disabled-hint")).toHaveAttribute(
      "title",
      "You need the Admin or Lead role to move cases"
    );
  });
});
