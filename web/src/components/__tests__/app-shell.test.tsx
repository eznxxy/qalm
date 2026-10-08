import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

/**
 * jsdom has no matchMedia. The §3 collapse hook reads (max-width: 1279px) on
 * every shell render — default "wide" (no collapse); the tests below flip
 * `mockViewportNarrow` to simulate a ≤1279px window.
 */
let mockViewportNarrow = false;
const mediaListeners = new Set<() => void>();
function mediaQuery() {
  return {
    // Live getter: a real MediaQueryList updates .matches when the window
    // resizes, and the hook keeps the query object across listener events.
    get matches() {
      return mockViewportNarrow;
    },
    media: "(max-width: 1279px)",
    onchange: null,
    addEventListener: (_: string, listener: () => void) => {
      mediaListeners.add(listener);
    },
    removeEventListener: (_: string, listener: () => void) => {
      mediaListeners.delete(listener);
    },
    addListener: (listener: () => void) => {
      mediaListeners.add(listener);
    },
    removeListener: (listener: () => void) => {
      mediaListeners.delete(listener);
    },
  };
}
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: jest.fn().mockImplementation(() => mediaQuery()),
  });
});

afterEach(() => {
  mockViewportNarrow = false;
  mediaListeners.clear();
  window.localStorage.clear();
  document.documentElement.className = "";
});

/** Simulates the OS-level viewport crossing the 1280 breakpoint. */
function setViewport(narrow: boolean): void {
  mockViewportNarrow = narrow;
  act(() => {
    for (const listener of mediaListeners) listener();
  });
}

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

describe("sidebar collapse (§3 breakpoints, card t_df4894c3)", () => {
  it("renders a keyboard toggle reporting aria-expanded", async () => {
    await renderShell();

    const toggle = screen.getByRole("button", { name: "Collapse sidebar" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("auto-collapses below 1280 and restores above it", async () => {
    setViewport(true);
    await renderShell();

    const toggle = screen.getByRole("button", { name: "Collapse sidebar" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.documentElement).toHaveClass("sidebar-collapsed");

    setViewport(false);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(document.documentElement).not.toHaveClass("sidebar-collapsed");
  });

  it("keeps a wide default when the viewport never crosses 1280", async () => {
    await renderShell();

    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    expect(document.documentElement).not.toHaveClass("sidebar-collapsed");
  });

  it("persists an explicit toggle in localStorage and honours it on remount", async () => {
    const initial = await renderShell();

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(document.documentElement).toHaveClass("sidebar-collapsed");
    expect(window.localStorage.getItem("qalm.sidebar.collapsed")).toBe("1");
    initial.unmount();

    // Next visit at a wide viewport: the stored choice wins over the default.
    const second = await renderShell();
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    expect(document.documentElement).toHaveClass("sidebar-collapsed");
    second.unmount();
  });

  it("an explicit expand sticks at narrow widths too (stored 0 wins over the breakpoint)", async () => {
    window.localStorage.setItem("qalm.sidebar.collapsed", "0");
    setViewport(true);
    await renderShell();

    expect(document.documentElement).not.toHaveClass("sidebar-collapsed");
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
  });

  it("toggling in the collapsed rail writes 0 and re-expands", async () => {
    window.localStorage.setItem("qalm.sidebar.collapsed", "1");
    await renderShell();

    expect(document.documentElement).toHaveClass("sidebar-collapsed");
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(document.documentElement).not.toHaveClass("sidebar-collapsed");
    expect(window.localStorage.getItem("qalm.sidebar.collapsed")).toBe("0");
  });

  it("nav stays keyboard-reachable in the icon rail (labels kept for AT)", async () => {
    window.localStorage.setItem("qalm.sidebar.collapsed", "1");
    await renderShell();

    const cases = screen.getByRole("link", { name: "Test cases" });
    expect(cases).toBeInTheDocument(); // accessible name survives the rail
    expect(cases).toHaveAttribute("title", "Test cases");
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

  it("is enabled once projects are listed, and disabled while loading", async () => {
    const ready = await renderShell();
    // findByRole resolves as soon as the combobox exists — during the
    // loading state — so wait for the real options before asserting.
    await screen.findByRole("option", { name: "Payments" });
    expect(screen.getByRole("combobox", { name: "Project" })).toBeEnabled();
    // Unmount before the second mount: two shells would duplicate the
    // switcher's element ids and break label association.
    ready.unmount();

    // Fresh mount with a pending project fetch: the placeholder option is
    // showing and interaction is off until real options land.
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const { AppShell } = await import("@/components/app-shell");
    const { SessionProvider } = await import("@/lib/session");
    render(
      <SessionProvider>
        <AppShell>
          <p>page content</p>
        </AppShell>
      </SessionProvider>
    );
    expect(screen.getByRole("combobox", { name: "Project" })).toBeDisabled();
    expect(screen.getByRole("option", { name: "Loading projects…" })).toBeInTheDocument();
  });
});

describe("top bar", () => {
  it("has a skip link, brand, help affordance, and account menu with logout", async () => {
    await renderShell();

    expect(screen.getByRole("link", { name: "Skip to content" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Qalm" })).toBeInTheDocument();
    // §7 (t_6ce021c1): the ? affordance opens the shortcuts dialog in place.
    const help = screen.getByRole("button", { name: "Keyboard shortcuts help" });
    expect(help).toHaveAttribute("aria-haspopup", "dialog");

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
