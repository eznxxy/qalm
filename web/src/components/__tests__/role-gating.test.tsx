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

  /** Installs the API mock for a logged-in session as `user`. */
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
      return Promise.reject(new Error(`unexpected ${url}`));
    });
  }

  it("admin sees the Users nav item and the users table loads", async () => {
    mockApiFor(USER_ADA);
    const { default: UsersPage } = await import("@/app/users/page");
    const { AppNav } = await import("@/components/app-nav");
    const { SessionProvider } = await import("@/lib/session");

    render(
      <SessionProvider>
        <AppNav />
        <UsersPage />
      </SessionProvider>
    );
    await screen.findByRole("link", { name: "Users" });
    await screen.findByText("grace@example.com");
    expect(screen.getByRole("button", { name: "Create user" })).toBeInTheDocument();

    const usersCall = fetchMock.mock.calls.find((c) => c[0].includes("/users"));
    expect(usersCall[0]).toContain("limit=25");
    expect(usersCall[1].headers.Authorization).toBe("Bearer tok-r");
  });

  it.each(["lead", "tester", "viewer"] as const)(
    "%s never sees user management: no nav item, page says Forbidden, no /users call",
    async (role) => {
      mockApiFor(makeUser({ role }));
      const { default: UsersPage } = await import("@/app/users/page");
      const { AppNav } = await import("@/components/app-nav");
      const { SessionProvider } = await import("@/lib/session");

      render(
        <SessionProvider>
          <AppNav />
          <UsersPage />
        </SessionProvider>
      );
      await screen.findByText(/Ada Lovelace/);
      expect(screen.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();
      expect(await screen.findByText("Forbidden")).toBeInTheDocument();
      expect(fetchMock.mock.calls.some((c) => c[0].includes("/users"))).toBe(false);
    }
  );

  it("nav shows the temp-password link when must_change_password is set", async () => {
    const { AppNav } = await import("@/components/app-nav");
    const { SessionProvider } = await import("@/lib/session");
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/auth/refresh")) {
        return Promise.resolve(
          jsonResponse(200, {
            data: { access_token: "tok-r", token_type: "Bearer", expires_in: 900 },
          })
        );
      }
      return Promise.resolve(
        jsonResponse(200, { data: makeUser({ must_change_password: true }) })
      );
    });

    render(
      <SessionProvider>
        <AppNav />
      </SessionProvider>
    );
    expect(await screen.findByRole("link", { name: "Change password" })).toBeInTheDocument();
  });

  it("nav hides the temp-password link once the password is changed", async () => {
    const { AppNav } = await import("@/components/app-nav");
    const { SessionProvider } = await import("@/lib/session");
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/auth/refresh")) {
        return Promise.resolve(
          jsonResponse(200, {
            data: { access_token: "tok-r", token_type: "Bearer", expires_in: 900 },
          })
        );
      }
      return Promise.resolve(jsonResponse(200, { data: makeUser() }));
    });

    render(
      <SessionProvider>
        <AppNav />
      </SessionProvider>
    );
    await screen.findByText(/Ada Lovelace/);
    expect(screen.queryByRole("link", { name: "Change password" })).not.toBeInTheDocument();
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

    const { default: UsersPage } = await import("@/app/users/page");
    const { SessionProvider } = await import("@/lib/session");
    render(
      <SessionProvider>
        <UsersPage />
      </SessionProvider>
    );

    // RequireAuth flips to unauthenticated and replaces to /login; the mocked
    // router makes that a no-op, so the gate shows its redirect state and no
    // data call is made.
    expect(await screen.findByText("Redirecting to login…")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => c[0].includes("/users"))).toBe(false);
  });
});
