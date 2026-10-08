import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import type { Project, User } from "@/lib/api-types";

/**
 * Unit tests for the §3 app shell (card t_a192444c): nav items + active
 * state, admin-only Users item, project switcher (URL as scope), top-bar
 * search wiring, and the (app) layout pairing (gate + banner + shell).
 *
 * Router is mocked per file with a mutable search string so ?project= state
 * can be exercised (jest.mock factories are hoisted; names start with `mock`).
 */
const mockRouterState = {
  search: "",
  pathname: "/projects",
  slug: "cases",
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
  usePathname: () => mockRouterState.pathname,
  useSearchParams: () => new URLSearchParams(mockRouterState.search),
  useParams: () => ({ slug: mockRouterState.slug }),
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

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "p-1",
    key: "PAY",
    name: "Payments",
    description: "Checkout and billing flows",
    status: "active",
    created_by: "u-1",
    created_at: "2026-10-07T12:00:00Z",
    updated_at: "2026-10-07T12:00:00Z",
    ...overrides,
  };
}

const ADMIN = makeUser();
const CHECKOUT = makeProject({ id: "p-2", key: "CHK", name: "Checkout" });

let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  mockRouterState.search = "";
  mockRouterState.pathname = "/projects";
  mockRouterState.slug = "cases";
  mockRouterState.replace.mockClear();
  mockRouterState.push.mockClear();
});

/** Session bootstrap + project list for the switcher. */
function stubSession(user: User, projects: Project[] = [makeProject(), CHECKOUT]) {
  fetchMock.mockImplementation((url: string) => {
    if (url.includes("/auth/refresh")) {
      return Promise.resolve(
        jsonResponse(200, {
          data: { access_token: "tok-r", token_type: "Bearer", expires_in: 900 },
        })
      );
    }
    if (url.includes("/auth/me")) {
      return Promise.resolve(jsonResponse(200, { data: user }));
    }
    if (url.includes("/projects")) {
      return Promise.resolve(
        jsonResponse(200, {
          data: projects,
          meta: { page: 1, limit: 200, total: projects.length, total_pages: 1 },
        })
      );
    }
    return Promise.reject(new Error(`unexpected ${url}`));
  });
}

async function renderShell(user: User = ADMIN) {
  stubSession(user);
  const { AppShell } = await import("@/components/app-shell");
  const { SessionProvider } = await import("@/lib/session");
  const view = render(
    <SessionProvider>
      <AppShell>
        <p>page content</p>
      </AppShell>
    </SessionProvider>
  );
  await screen.findByRole("combobox", { name: "Project" });
  return view;
}

describe("sidebar navigation", () => {
  it("renders the §3 items with the current route marked aria-current", async () => {
    await renderShell();

    for (const label of [
      "Overview",
      "Test cases",
      "Test runs",
      "Test plans",
      "Milestones",
      "Reports",
      "Settings",
    ]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Test runs" })).toBeInTheDocument();
  });

  it("marks the active nav item with aria-current=page", async () => {
    mockRouterState.pathname = "/wip/cases";
    await renderShell();

    expect(screen.getByRole("link", { name: "Test cases" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(screen.getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
  });

  it("points unbuilt sections at their /wip/[slug] placeholder routes", async () => {
    await renderShell();

    for (const [label, href] of [
      ["Overview", "/wip/overview"],
      ["Test cases", "/wip/cases"],
      ["Test runs", "/wip/runs"],
      ["Test plans", "/wip/plans"],
      ["Milestones", "/wip/milestones"],
      ["Reports", "/wip/reports"],
      ["Settings", "/settings"],
    ] as const) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", expect.stringContaining(href));
    }
  });

  it("admin sees the Users item; other roles do not (both keep Settings)", async () => {
    const admin = await renderShell(makeUser({ role: "admin" }));
    expect(screen.getByRole("link", { name: "Users" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
    admin.unmount();

    await renderShell(makeUser({ id: "u-9", role: "tester" }));
    expect(screen.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
  });

  it("nav links carry the selected project scope (?project=)", async () => {
    mockRouterState.search = "project=p-2";
    await renderShell();

    const cases = screen.getByRole("link", { name: "Test cases" });
    expect(cases).toHaveAttribute("href", "/wip/cases?project=p-2");
  });
});

describe("project switcher", () => {
  it("lists existing projects and preselects ?project= from the URL", async () => {
    mockRouterState.search = "project=p-2";
    await renderShell();

    const switcher = screen.getByRole("combobox", { name: "Project" }) as HTMLSelectElement;
    expect(switcher.value).toBe("p-2");
    expect(screen.getByRole("option", { name: "Payments" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Checkout" })).toBeInTheDocument();
  });

  it("falls back to the first project when the URL has no ?project=", async () => {
    await renderShell();

    const switcher = screen.getByRole("combobox", { name: "Project" }) as HTMLSelectElement;
    expect(switcher.value).toBe("p-1");
  });

  it("writes the scope to the URL on change", async () => {
    await renderShell();

    fireEvent.change(screen.getByRole("combobox", { name: "Project" }), {
      target: { value: "p-2" },
    });

    await waitFor(() =>
      expect(mockRouterState.replace).toHaveBeenCalledWith("/projects?project=p-2", {
        scroll: false,
      })
    );
  });
});

describe("top bar", () => {
  it("has a skip link, brand, help affordance, and account menu with logout", async () => {
    await renderShell();

    expect(screen.getByRole("link", { name: "Skip to content" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Qalm" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Help" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Account menu for Ada Lovelace" }));
    expect(screen.getByRole("link", { name: "Account settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
  });

  it("search submits to the projects list with the query", async () => {
    await renderShell();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search cases and runs" }), {
      target: { value: "login" },
    });
    fireEvent.submit(screen.getByRole("searchbox", { name: "Search cases and runs" }));

    await waitFor(() =>
      expect(mockRouterState.push).toHaveBeenCalledWith("/projects?query=login")
    );
  });

  it("an empty search goes to the plain projects list", async () => {
    await renderShell();

    fireEvent.submit(screen.getByRole("searchbox", { name: "Search cases and runs" }));

    await waitFor(() => expect(mockRouterState.push).toHaveBeenCalledWith("/projects"));
  });
});

describe("(app) layout", () => {
  it("pairs the auth gate, shell chrome, and banner slot; content renders inside", async () => {
    stubSession(ADMIN);
    const { default: AppLayout } = await import("@/app/(app)/layout");
    const { SessionProvider } = await import("@/lib/session");
    render(
      <SessionProvider>
        <AppLayout>
          <p>screen body</p>
        </AppLayout>
      </SessionProvider>
    );

    expect(await screen.findByText("screen body")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Project" })).toBeInTheDocument();
    // must_change_password=false → no banner.
    expect(screen.queryByText(/Your password is temporary/)).not.toBeInTheDocument();
  });

  it("shows the must-change-password banner for temporary passwords", async () => {
    stubSession(makeUser({ must_change_password: true }));
    const { default: AppLayout } = await import("@/app/(app)/layout");
    const { SessionProvider } = await import("@/lib/session");
    render(
      <SessionProvider>
        <AppLayout>
          <p>screen body</p>
        </AppLayout>
      </SessionProvider>
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your password is temporary. Please set your own password now."
    );
  });
});

describe("not-built-yet placeholder (/wip/[slug])", () => {
  it("renders the §6 one-sentence empty state, no fake screens", async () => {
    const { default: NotBuiltPage } = await import("@/app/(app)/wip/[slug]/page");
    render(<NotBuiltPage />);

    expect(screen.getByRole("heading", { name: "Test cases" })).toBeInTheDocument();
    expect(screen.getByText("This screen is not built yet.")).toBeInTheDocument();
  });

  it("falls back to the raw slug for unknown segments", async () => {
    const { default: NotBuiltPage } = await import("@/app/(app)/wip/[slug]/page");
    mockRouterState.slug = "somewhere-else";
    render(<NotBuiltPage />);

    expect(screen.getByRole("heading", { name: "somewhere-else" })).toBeInTheDocument();
  });
});
