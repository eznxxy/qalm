import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import type {
  Plan,
  Project,
  Result,
  Role,
  Run,
  RunItem,
  RunItemDetail,
  SuiteNode,
  User,
} from "@/lib/api-types";

/**
 * Run detail (card 3.2). Covers the behaviour the primitives do not own: the
 * header rollup, the items table mapping, URL-as-state for the drawer and the
 * filters, the close/reopen action and the role/archived read-only rules.
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
  usePathname: () => "/runs/r-1",
  useParams: () => ({ id: "r-1" }),
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

/** A project suite the run has no items from — the Section filter must hide it. */
function otherSuite(): SuiteNode {
  return {
    ...suite(),
    id: "s-2",
    name: "Refunds",
    position: 2,
  };
}

function run(overrides: Partial<Run> = {}): Run {
  return {
    id: "r-1",
    project_id: "p-1",
    plan_id: "pl-1",
    name: "Release 2.4 smoke",
    description: "Smoke pass.",
    status: "open",
    start_date: "2026-11-01",
    due_date: "2026-11-14",
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
    assignee_ids: ["u-1"],
    suite_ids: ["s-1"],
    created_by: "u-1",
    updated_by: "u-1",
    created_at: "2026-10-24T09:00:00Z",
    updated_at: "2026-10-24T09:00:00Z",
    ...overrides,
  };
}

function item(overrides: Partial<RunItem> = {}): RunItem {
  return {
    id: "i-1",
    run_id: "r-1",
    case_id: "c-1",
    case_display_id: "C1042",
    case_title: "Pay with a saved card",
    case_priority: "high",
    case_suite_id: "s-1",
    assignee_id: "u-1",
    position: 1,
    status: "untested",
    result_count: 0,
    latest_result: null,
    created_at: "2026-10-24T09:00:00Z",
    updated_at: "2026-10-24T09:00:00Z",
    ...overrides,
  };
}

const ITEM_2 = item({
  id: "i-2",
  case_display_id: "C1043",
  case_title: "Card declined message",
  assignee_id: null,
  position: 2,
  status: "failed",
  result_count: 1,
});

function detail(): RunItemDetail {
  return {
    ...item(),
    case_steps: [
      { position: 1, text: "Open checkout", expected_result: "Cart shows" },
      { position: 2, text: "Pick the saved card", expected_result: null },
    ],
    case_preconditions: "Signed in as a returning customer.",
  };
}

function result(overrides: Partial<Result> = {}): Result {
  return {
    id: "res-1",
    run_item_id: "i-1",
    status: "passed",
    comment: "All good",
    elapsed_minutes: 5,
    defect_url: null,
    attachments: [],
    created_by: "u-1",
    created_by_name: "Tess Tester",
    created_at: "2026-10-25T09:00:00Z",
    ...overrides,
  };
}

let fetchMock: jest.Mock;
let closeCalled: boolean;
let assignBodies: { assignee_id: string | null; item_ids?: string[] }[];

interface ApiOptions {
  role?: Role;
  project?: Project;
  run?: Run | "missing";
  items?: RunItem[];
  /** The single item GET /runs/:id/items/:itemId returns. */
  itemDetail?: RunItemDetail;
  results?: Result[];
  /** The project's suite tree — wider than the run's suites on purpose. */
  suites?: SuiteNode[];
}

function mockApi({
  role = "admin",
  project = PROJECT,
  run: theRun = run(),
  items = [item(), ITEM_2],
  itemDetail = detail(),
  results = [],
  suites = [suite(), otherSuite()],
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
      if (/\/runs\/[\w-]+\/items\/[\w-]+\/results(\?|$)/.test(target)) {
        return Promise.resolve(
          jsonResponse(200, {
            data: results,
            meta: { page: 1, limit: 25, total: results.length, total_pages: 1 },
          })
        );
      }
      if (/\/runs\/[\w-]+\/items\/[\w-]+$/.test(target) && method === "GET") {
        return Promise.resolve(jsonResponse(200, { data: itemDetail }));
      }
      if (/\/runs\/[\w-]+\/items(\?|$)/.test(target) && method === "GET") {
        return Promise.resolve(
          jsonResponse(200, {
            data: items,
            meta: { page: 1, limit: 25, total: items.length, total_pages: 1 },
          })
        );
      }
      if (/\/runs\/[\w-]+\/assign$/.test(target) && method === "POST") {
        assignBodies.push(
          JSON.parse(String(init?.body)) as {
            assignee_id: string | null;
            item_ids?: string[];
          }
        );
        return Promise.resolve(
          jsonResponse(200, { data: { assigned: items.length } })
        );
      }
      if (/\/runs\/[\w-]+\/close$/.test(target) && method === "POST") {
        closeCalled = true;
        return Promise.resolve(
          jsonResponse(200, {
            data: run({
              status: "completed",
              completed_at: "2026-10-26T10:00:00Z",
              completed_by: "u-1",
            }),
          })
        );
      }
      if (/\/runs\/[\w-]+$/.test(target) && method === "GET") {
        if (theRun === "missing") {
          return Promise.resolve(
            jsonResponse(404, {
              error: { code: "NOT_FOUND", message: "Run not found." },
            })
          );
        }
        return Promise.resolve(jsonResponse(200, { data: theRun }));
      }
      if (/\/projects\/[\w-]+\/plans(\?|$)/.test(target) && method === "GET") {
        return Promise.resolve(
          jsonResponse(200, {
            data: [PLAN],
            meta: { page: 1, limit: 100, total: 1, total_pages: 1 },
          })
        );
      }
      if (/\/projects\/[\w-]+\/suites$/.test(target) && method === "GET") {
        return Promise.resolve(jsonResponse(200, { data: suites }));
      }
      if (/\/users(\?|$)/.test(target) && method === "GET") {
        return Promise.resolve(
          jsonResponse(200, {
            data: [user],
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
  const { default: RunDetailPage } = await import("@/app/(app)/runs/[id]/page");
  const { RequireAuth } = await import("@/components/require-auth");
  const { SessionProvider } = await import("@/lib/session");
  return render(
    <SessionProvider>
      <RequireAuth>
        <RunDetailPage />
      </RequireAuth>
    </SessionProvider>
  );
}

function lastReplaceUrl(): string {
  const calls = mockRouterState.replace.mock.calls;
  return String(calls[calls.length - 1]?.[0] ?? "");
}

function itemListCalls(): string[] {
  return fetchMock.mock.calls
    .map(([url, init]) => ({ url: String(url), init }))
    .filter(
      ({ url, init }) =>
        /\/runs\/[\w-]+\/items(\?|$)/.test(url) &&
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
  closeCalled = false;
  assignBodies = [];
});

describe("run detail", () => {
  it("renders the header, rollup and the items table", async () => {
    mockApi();
    await renderPage();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Release 2.4 smoke" })
    ).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
    // Subtitle stitches project · plan · start date · due date.
    expect(
      screen.getByText(
        "Payments · Release 2.4 · Starts 1 Nov 2026 · Due 14 Nov 2026"
      )
    ).toBeInTheDocument();

    const table = await screen.findByRole("table", { name: "Run items" });
    expect(
      within(table).getByRole("button", {
        name: "Open C1042 · Pay with a saved card",
      })
    ).toBeInTheDocument();
    // The failed item carries its status badge in the Status column.
    expect(within(table).getByText("Failed")).toBeInTheDocument();

    // The list was fetched with the default (position) sort.
    expect(itemListCalls()[0]).toContain("sort=position");
  });

  it("omits the dates from the subtitle when the run has none", async () => {
    mockApi({ run: run({ start_date: null, due_date: null }) });
    await renderPage();

    await screen.findByRole("heading", { level: 1, name: "Release 2.4 smoke" });
    expect(screen.getByText("Payments · Release 2.4")).toBeInTheDocument();
  });

  it("rolls the run up as a pie with every status in the legend", async () => {
    mockApi();
    await renderPage();

    const summary = await screen.findByRole("group", {
      name: "Release 2.4 smoke results by status",
    });
    // The numbers live in the legend now: count on top, share below.
    expect(within(summary).getByText("2 Passed")).toBeInTheDocument();
    expect(within(summary).getByText("50% set to Passed")).toBeInTheDocument();
    expect(within(summary).getByText("1 Failed")).toBeInTheDocument();
    expect(within(summary).getByText("25% set to Failed")).toBeInTheDocument();
    expect(within(summary).getByText("1 Untested")).toBeInTheDocument();
    // All six statuses are listed, zeros included.
    const titles = Array.from(
      summary.querySelectorAll(".stp-legend-title")
    ).map((el) => el.textContent);
    expect(titles).toEqual([
      "2 Passed",
      "0 Retest",
      "0 Blocked",
      "1 Failed",
      "0 Skipped",
      "1 Untested",
    ]);
    // The old progress bar is gone from this screen.
    expect(summary.querySelector(".stb-root")).toBeNull();
    // The headline sits on its own card beside the pie (reviewer's reference),
    // not inside the breakdown.
    const card = document.querySelector(".sts-root") as HTMLElement;
    expect(card).toBeInTheDocument();
    expect(card.closest(".rd-summary")).toBeInTheDocument();
    expect(within(card).getByText("50%")).toBeInTheDocument();
    expect(within(card).getByText("passed")).toBeInTheDocument();
    expect(within(card).getByText("1 / 4 untested (25%).")).toBeInTheDocument();
    expect(summary.contains(card)).toBe(false);
  });

  it("opens the result drawer through ?item in the URL", async () => {
    mockApi();
    await renderPage();

    const table = await screen.findByRole("table", { name: "Run items" });
    fireEvent.click(
      within(table).getByRole("button", {
        name: "Open C1042 · Pay with a saved card",
      })
    );

    await waitFor(() => expect(lastReplaceUrl()).toContain("item=i-1"));
  });

  it("renders the drawer for a deep link (?item) with the case steps", async () => {
    mockRouterState.search = "project=p-1&item=i-1";
    mockApi({ results: [result()] });
    await renderPage();

    expect(
      await screen.findByRole("heading", { name: /Add result/ })
    ).toBeInTheDocument();
    expect(screen.getByText("Signed in as a returning customer.")).toBeInTheDocument();
    expect(screen.getByText("Pick the saved card")).toBeInTheDocument();
    // The page hands the drawer the item's history from the results endpoint.
    expect(await screen.findByText("All good")).toBeInTheDocument();
  });

  it("resets the page in the URL when a filter changes", async () => {
    mockApi();
    await renderPage();
    await screen.findByRole("table", { name: "Run items" });

    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "failed" },
    });

    await waitFor(() => expect(lastReplaceUrl()).toContain("status=failed"));
  });

  it("offers only the suites the run has items from in the Section filter", async () => {
    // The project also has Refunds, but this run has no items from it, so
    // filtering by it could only ever return zero rows.
    mockApi({ run: run({ suite_ids: ["s-1"] }) });
    await renderPage();

    await screen.findByRole("table", { name: "Run items" });
    await screen.findByRole("option", { name: "Checkout" });

    const options = within(screen.getByLabelText("Section"))
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(options).toEqual(["All sections", "Checkout"]);
  });

  it("keeps a section already in the URL when the run has no items from it", async () => {
    // e.g. an item was removed after the link was shared: the value must stay
    // selectable, or the control would snap back to "All sections" silently.
    mockApi({ run: run({ suite_ids: [] }) });
    mockRouterState.search = "project=p-1&suite=s-9";
    await renderPage();

    await screen.findByRole("table", { name: "Run items" });
    expect(
      await screen.findByRole("option", { name: "Selected section" })
    ).toBeInTheDocument();
  });

  it("hides the read-only chrome and assign/close for a Viewer", async () => {
    mockApi({ role: "viewer" });
    await renderPage();

    await screen.findByRole("table", { name: "Run items" });
    expect(
      screen.getByText(/Viewers can read this run but can't record results/)
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close run" })).toBeNull();
    expect(screen.getByRole("button", { name: "Assign" })).toBeDisabled();
    // No selection column for a role that cannot assign (card 3.17).
    expect(screen.queryByRole("checkbox", { name: /Select row/ })).toBeNull();
  });

  it("closes the run and flips the header to Completed", async () => {
    mockApi();
    await renderPage();
    await screen.findByRole("table", { name: "Run items" });

    fireEvent.click(screen.getByRole("button", { name: "Close run" }));

    await waitFor(() => expect(closeCalled).toBe(true));
    expect(
      await screen.findByRole("button", { name: "Reopen" })
    ).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("tells a Lead the run is read-only while the project is archived", async () => {
    mockApi({ role: "lead", project: ARCHIVED });
    await renderPage();

    await screen.findByRole("table", { name: "Run items" });
    expect(
      screen.getByText("This project is archived — this run is read-only.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Assign" })).toBeDisabled();
  });

  it("renders Run not found for a 404", async () => {
    mockApi({ run: "missing" });
    await renderPage();

    expect(
      await screen.findByRole("heading", { name: "Run not found" })
    ).toBeInTheDocument();
  });

  it("assigns only the ticked items (card 3.17)", async () => {
    mockApi();
    await renderPage();
    await screen.findByRole("table", { name: "Run items" });

    fireEvent.click(screen.getByRole("checkbox", { name: "Select row 1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select row 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));

    const dialog = await screen.findByRole("dialog", { name: "Assign items" });
    expect(
      within(dialog).getByText(/^2 selected items\./)
    ).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Assignee"), {
      target: { value: "u-1" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Assign" }));

    await waitFor(() => expect(assignBodies).toHaveLength(1));
    expect(assignBodies[0]).toEqual({
      assignee_id: "u-1",
      item_ids: ["i-1", "i-2"],
    });

    // The selection was consumed by the action: the next Assign is whole-run.
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: "Select row 1" })
      ).not.toBeChecked()
    );
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    expect(
      await screen.findByText(/^All 4 items\./)
    ).toBeInTheDocument();
  });

  it("assigns the whole run when nothing is ticked (card 3.17)", async () => {
    mockApi();
    await renderPage();
    await screen.findByRole("table", { name: "Run items" });

    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    const dialog = await screen.findByRole("dialog", { name: "Assign items" });
    expect(within(dialog).getByText(/^All 4 items\./)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Assign" }));

    await waitFor(() => expect(assignBodies).toHaveLength(1));
    // No `item_ids` key at all: the contract reads that as "every item".
    expect(assignBodies[0]).toEqual({ assignee_id: null });
  });
});