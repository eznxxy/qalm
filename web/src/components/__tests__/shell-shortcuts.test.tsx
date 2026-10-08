import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import type { Project, User } from "@/lib/api-types";

/**
 * Unit tests for the §7 shell shortcuts (card t_6ce021c1): /, g→c/r/p,
 * ?, n, their typing guards, and the help dialog. The keymap primitives
 * themselves are covered in keymap.test.tsx; Esc-on-dialogs is covered by
 * the existing suites (confirm-dialog via projects-page tests, account menu
 * via app-shell tests).
 *
 * Shares the router/fetch mocking style of app-shell.test.tsx.
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
  window.localStorage.clear();
  document.documentElement.className = "";
});

/** Session bootstrap + project list for the switcher. */
function stubSession(user: User = ADMIN, projects: Project[] = [makeProject(), CHECKOUT]) {
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
  await screen.findByRole("option", { name: "Payments" });
  return view;
}

describe("§7 shortcuts", () => {
  it("/ focuses the top-bar search input", async () => {
    await renderShell();
    fireEvent.keyDown(window, { key: "/" });
    expect(document.activeElement).toBe(screen.getByRole("searchbox"));
  });

  it("no shortcut fires while a form field has focus", async () => {
    await renderShell();
    const box = screen.getByRole("searchbox");
    box.focus();

    // Real keystrokes target the focused element; each must be swallowed.
    fireEvent.keyDown(box, { key: "?" });
    fireEvent.keyDown(box, { key: "n" });
    fireEvent.keyDown(box, { key: "g" });
    fireEvent.keyDown(box, { key: "c" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockRouterState.push).not.toHaveBeenCalled();
    // Focus stayed in the field — nothing was hijacked.
    expect(document.activeElement).toBe(box);
  });

  it("g then c / r / p navigates (carrying the project scope), g then x does not", async () => {
    mockRouterState.search = "project=p-2";
    await renderShell();

    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "c" });
    await waitFor(() =>
      expect(mockRouterState.push).toHaveBeenCalledWith("/wip/cases?project=p-2")
    );

    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "r" });
    await waitFor(() =>
      expect(mockRouterState.push).toHaveBeenCalledWith("/wip/runs?project=p-2")
    );

    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "p" });
    await waitFor(() =>
      expect(mockRouterState.push).toHaveBeenCalledWith("/wip/plans?project=p-2")
    );

    // An unpaired trailing key arms nothing: a bare "c" is not a shortcut.
    fireEvent.keyDown(window, { key: "c" });
    expect(mockRouterState.push).toHaveBeenCalledTimes(3);
  });

  it("a lone g navigates nowhere until a suffix arrives", async () => {
    await renderShell();
    fireEvent.keyDown(window, { key: "g" });
    expect(mockRouterState.push).not.toHaveBeenCalled();
  });

  it("? opens the shortcuts help dialog, Esc and Close close it", async () => {
    const view = await renderShell();

    // The user tabbed to the ? affordance and pressed ?; focus is captured
    // at open time and restored on close.
    const helpButton = screen.getByRole("button", { name: "Keyboard shortcuts help" });
    helpButton.focus();
    fireEvent.keyDown(window, { key: "?" });

    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(dialog).toHaveAttribute("aria-modal", "true");

    // Every wired §7 shortcut is listed; deferred ones are marked later.
    expect(screen.getAllByText("Go to Test cases")[0]).toBeInTheDocument();
    expect(screen.getByText("Focus search")).toBeInTheDocument();
    expect(screen.getByText(/New \(context-aware/)).toBeInTheDocument();
    expect(screen.getByText("Set result status (result form — later slice)")).toBeInTheDocument();
    expect(screen.getByText("Move between rows (run detail — later slice)")).toBeInTheDocument();
    expect(screen.getByText("Save the open form (result form — later slice)")).toBeInTheDocument();

    // Focus moved into the dialog; Esc closes it and restores focus.
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(helpButton);

    // Re-open via the button (not just the key), close with its Close.
    fireEvent.click(helpButton);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    view.unmount();
  });

  it("the help dialog traps Tab and swallows page shortcuts while open", async () => {
    await renderShell();
    fireEvent.keyDown(window, { key: "?" });

    // `n` while the modal is up must not reach the page map (real keystroke
    // goes through document, where the capture shield sits).
    fireEvent.keyDown(document, { key: "n" });
    expect(mockRouterState.push).not.toHaveBeenCalled();

    // Tab cycles inside the dialog (Close button is the only stop).
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toHaveAccessibleName("Close");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("? does not fire from inside the search box while typing", async () => {
    await renderShell();
    const box = screen.getByRole("searchbox");
    box.focus();
    fireEvent.keyDown(box, { key: "?", bubbles: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("/ still works from inside a plain page element (allowInInputs opt-in)", async () => {
    await renderShell();
    fireEvent.keyDown(document.body, { key: "/" });
    expect(document.activeElement).toBe(screen.getByRole("searchbox"));
  });

  describe("n (context-aware new)", () => {
    it("on projects with the form closed: opens it and moves focus into it", async () => {
      await renderShell();
      fireEvent.keyDown(window, { key: "n" });
      // scopedHref carries the fallback scope (first project) — the shell's
      // project-scoped navigation rule.
      await waitFor(() =>
        expect(mockRouterState.push).toHaveBeenCalledWith("/projects?project=p-1")
      );
    });

    it("on projects with the form open: focuses the form instead of re-navigating", async () => {
      await renderShell();
      // The (app) children render the real screen; emulate the projects
      // screen's create form: aria-label on the form element, the Name
      // field as its first control.
      render(
        <form aria-label="Create project">
          <h2>Create project</h2>
          <input aria-label="Name" />
        </form>,
        { container: document.querySelector(".shell-content") as HTMLElement }
      );
      fireEvent.keyDown(window, { key: "n" });
      expect(mockRouterState.push).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(screen.getByLabelText("Name"));
    });

    it("off projects: navigates to projects (the current context's new target)", async () => {
      mockRouterState.pathname = "/wip/cases";
      await renderShell();
      fireEvent.keyDown(window, { key: "n" });
      await waitFor(() =>
        expect(mockRouterState.push).toHaveBeenCalledWith("/projects?project=p-1")
      );
    });

    it("carries the URL project scope when it navigates", async () => {
      mockRouterState.search = "project=p-2";
      mockRouterState.pathname = "/wip/cases";
      await renderShell();
      fireEvent.keyDown(window, { key: "n" });
      await waitFor(() =>
        expect(mockRouterState.push).toHaveBeenCalledWith("/projects?project=p-2")
      );
    });
  });

  it("the ? affordance in the top bar is a button that announces the dialog", async () => {
    await renderShell();
    const help = screen.getByRole("button", { name: "Keyboard shortcuts help" });
    expect(help).toHaveAttribute("aria-haspopup", "dialog");
    expect(help).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Help" })).not.toBeInTheDocument();
  });

  it("modifiers never trigger plain shortcuts (Ctrl+R stays browser reload)", async () => {
    await renderShell();
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    fireEvent.keyDown(window, { key: "r", ctrlKey: true });
    expect(mockRouterState.push).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("repeated g (key held down) does not arm the chord", async () => {
    await renderShell();
    // OS key-repeat sets repeat=true; the chord must ignore those.
    fireEvent.keyDown(window, { key: "g", repeat: true });
    fireEvent.keyDown(window, { key: "c" });
    expect(mockRouterState.push).not.toHaveBeenCalled();
  });
});
