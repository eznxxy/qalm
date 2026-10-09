import { render, screen } from "@testing-library/react";
import React from "react";
import type { User } from "@/lib/api-types";

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

const USER_ADA = makeUser();

const GRACE = makeUser({
  id: "u-2",
  email: "grace@example.com",
  name: "Grace Hopper",
  role: "tester",
  must_change_password: true,
});

describe("role gating", () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  /**
   * Installs the API mock for a logged-in session as `user`. Covers every
   * endpoint the rendered tree touches: the session bootstrap (/auth/refresh,
   * /auth/me), the users list, and the app shell's project-switcher list.
   */
  function mockApiFor(user: User) {
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
      if (url.includes("/users")) {
        return Promise.resolve(
          jsonResponse(200, {
            data: [GRACE],
            meta: { page: 1, limit: 25, total: 1, total_pages: 1 },
          })
        );
      }
      if (url.includes("/projects")) {
        return Promise.resolve(
          jsonResponse(200, { data: [], meta: { page: 1, limit: 200, total: 0, total_pages: 0 } })
        );
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });
  }

  it("admin loads the users table", async () => {
    mockApiFor(USER_ADA);
    const { default: UsersPage } = await import("@/app/(app)/users/page");
    const { SessionProvider } = await import("@/lib/session");

    render(
      <SessionProvider>
        <UsersPage />
      </SessionProvider>
    );
    await screen.findByText("grace@example.com");
    expect(screen.getByRole("button", { name: "Create user" })).toBeInTheDocument();

    const usersCall = fetchMock.mock.calls.find((c) => c[0].includes("/users"));
    expect(usersCall[0]).toContain("limit=25");
    expect(usersCall[1].headers.Authorization).toBe("Bearer tok-r");
  });

  it.each(["lead", "tester", "viewer"] as const)(
    "%s never reaches user management: page says Forbidden, no /users call",
    async (role) => {
      mockApiFor(makeUser({ role }));
      const { default: UsersPage } = await import("@/app/(app)/users/page");
      const { SessionProvider } = await import("@/lib/session");

      render(
        <SessionProvider>
          <UsersPage />
        </SessionProvider>
      );
      expect(await screen.findByText("Forbidden")).toBeInTheDocument();
      expect(fetchMock.mock.calls.some((c) => c[0].includes("/users"))).toBe(false);
    }
  );

  it("shell avatar menu shows the temp-password hint and account link when must_change_password is set", async () => {
    mockApiFor(makeUser({ must_change_password: true }));
    const { AppShell } = await import("@/components/app-shell");
    const { SessionProvider } = await import("@/lib/session");
    const { fireEvent } = await import("@testing-library/react");

    render(
      <SessionProvider>
        <AppShell>
          <p>content</p>
        </AppShell>
      </SessionProvider>
    );
    await screen.findByRole("button", { name: "Account menu for Ada Lovelace" });
    fireEvent.click(screen.getByRole("button", { name: "Account menu for Ada Lovelace" }));

    expect(
      screen.getByRole("link", { name: "Account settings" })
    ).toBeInTheDocument();
    expect(screen.getByText(/Your password is temporary/)).toBeInTheDocument();
  });

  it("shell avatar menu hides the temp-password hint once the password is changed", async () => {
    mockApiFor(makeUser());
    const { AppShell } = await import("@/components/app-shell");
    const { SessionProvider } = await import("@/lib/session");
    const { fireEvent } = await import("@testing-library/react");

    render(
      <SessionProvider>
        <AppShell>
          <p>content</p>
        </AppShell>
      </SessionProvider>
    );
    const avatar = await screen.findByRole("button", { name: "Account menu for Ada Lovelace" });
    fireEvent.click(avatar);

    expect(screen.getByRole("link", { name: "Account settings" })).toBeInTheDocument();
    expect(screen.queryByText(/Your password is temporary/)).not.toBeInTheDocument();
  });
});

describe("route protection", () => {
  it("without a refresh cookie the gated page shows the redirect-to-login state", async () => {
    const fetchMock = jest.fn().mockImplementation(() =>
      Promise.resolve(
        jsonResponse(401, { error: { code: "UNAUTHENTICATED", message: "no cookie" } })
      )
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    // The (app) layout pairs the gate with every page; reproduce that here.
    const { default: UsersPage } = await import("@/app/(app)/users/page");
    const { RequireAuth } = await import("@/components/require-auth");
    const { SessionProvider } = await import("@/lib/session");
    render(
      <SessionProvider>
        <RequireAuth>
          <UsersPage />
        </RequireAuth>
      </SessionProvider>
    );

    // RequireAuth flips to unauthenticated and replaces to /login; the mocked
    // router makes that a no-op, so the gate shows its redirect state and no
    // data call is made.
    expect(await screen.findByText("Redirecting to login…")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => c[0].includes("/users"))).toBe(false);
  });
});
