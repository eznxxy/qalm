/**
 * EditUserPanel save/reset-password flows on /users.
 *
 * Regression guard for the reset-password bug: the one-time password panel
 * ("Share this password now") must appear ONLY when the PATCH actually
 * succeeded, and the saved callback must fire exactly once per success —
 * never on failure (409/500) and never when the session is dead (401 with a
 * failed refresh), so an admin can never share a password that was not
 * applied.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
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

const USER_GRACE = makeUser({
  id: "u-2",
  email: "grace@example.com",
  name: "Grace Hopper",
  role: "tester",
});

interface HarnessOptions {
  /** Handles PATCH /users/:id; `appliedUser` becomes the stored list row. */
  patch?: () => { response: Response; appliedUser?: User };
  /** Refresh succeeds once (session bootstrap), then 401s — dead session. */
  refreshFailAfterFirst?: boolean;
}

/**
 * Installs a contract-shaped global fetch: session bootstrap (refresh + me),
 * GET /users list backed by a mutable stored row, and a stubbed PATCH.
 */
function stubApi(opts: HarnessOptions = {}): jest.Mock {
  let stored = USER_GRACE;
  let refreshCalls = 0;
  const fetchMock = jest.fn((url: string, init?: RequestInit): Promise<Response> => {
    const u = String(url);
    const method = init?.method ?? "GET";
    if (u.includes("/auth/refresh")) {
      refreshCalls += 1;
      if (opts.refreshFailAfterFirst && refreshCalls > 1) {
        return Promise.resolve(
          jsonResponse(401, { error: { code: "UNAUTHENTICATED", message: "no session" } })
        );
      }
      return Promise.resolve(
        jsonResponse(200, {
          data: { access_token: "tok-r", token_type: "Bearer", expires_in: 900 },
        })
      );
    }
    if (u.includes("/auth/me")) {
      return Promise.resolve(jsonResponse(200, { data: USER_ADA }));
    }
    if (u.includes("/users/") && method === "PATCH") {
      const result = opts.patch
        ? opts.patch()
        : { response: jsonResponse(500, { error: { code: "INTERNAL", message: "unexpected PATCH" } }) };
      if (result.appliedUser) stored = result.appliedUser;
      return Promise.resolve(result.response);
    }
    if (u.includes("/users?") && method === "GET") {
      return Promise.resolve(
        jsonResponse(200, {
          data: [stored],
          meta: { page: 1, limit: 25, total: 1, total_pages: 1 },
        })
      );
    }
    return Promise.reject(new Error(`unexpected ${method} ${u}`));
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

/** GET /users calls seen by the mock: the initial load fires exactly one. */
function listReloadCount(fetchMock: jest.Mock): number {
  return fetchMock.mock.calls.filter(
    (c) => String(c[0]).includes("/users?") && c[1]?.method === "GET"
  ).length;
}

function patchCalls(fetchMock: jest.Mock): jest.Mock["mock"]["calls"] {
  return fetchMock.mock.calls.filter(
    (c) => String(c[0]).includes("/users/") && c[1]?.method === "PATCH"
  );
}

async function openEditPanelForGrace() {
  const { default: UsersPage } = await import("@/app/(app)/users/page");
  const { RequireAuth } = await import("@/components/require-auth");
  const { SessionProvider } = await import("@/lib/session");

  // Production pairs the page with the RequireAuth gate (the (app) layout);
  // reproduce it so gate behaviour (dead-session takeover) is covered too.
  render(
    <SessionProvider>
      <RequireAuth>
        <UsersPage />
      </RequireAuth>
    </SessionProvider>
  );

  await screen.findByText("grace@example.com");
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  await screen.findByRole("form", { name: "Edit grace@example.com" });
}

function editFormNameField(): HTMLElement {
  const form = screen.getByRole("form", { name: "Edit grace@example.com" });
  return within(form).getByRole("textbox", { name: "Name" });
}

describe("EditUserPanel reset password", () => {
  it("PATCH 409: shows the error, keeps the panel closed, keeps the edit form open", async () => {
    const fetchMock = stubApi({
      patch: () => ({
        response: jsonResponse(409, {
          error: { code: "CONFLICT", message: "Would leave no active admin." },
        }),
      }),
    });

    await openEditPanelForGrace();
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    // The failure surfaces as an inline error in the (still open) edit panel.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Would leave no active admin."
    );
    expect(screen.getByRole("form", { name: "Edit grace@example.com" })).toBeInTheDocument();

    // The generated password was never applied — it must not be shown either.
    const patchInit = patchCalls(fetchMock)[0][1] as RequestInit;
    const sentPassword = (JSON.parse(String(patchInit.body)) as { password: string }).password;
    expect(sentPassword).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(document.body.textContent).not.toContain(sentPassword);

    expect(screen.queryByText("Share this password now")).not.toBeInTheDocument();
    // onSaved never fired: no reload beyond the initial mount load.
    expect(listReloadCount(fetchMock)).toBe(1);
    expect(patchCalls(fetchMock)).toHaveLength(1);
  });

  it("PATCH 500 (retried once by the API client): still no one-time password panel", async () => {
    const fetchMock = stubApi({
      patch: () => ({
        response: jsonResponse(500, { error: { code: "INTERNAL", message: "boom" } }),
      }),
    });

    await openEditPanelForGrace();
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
    expect(screen.queryByText("Share this password now")).not.toBeInTheDocument();
    // The client retried the 500 once, then gave up: still a failure path.
    expect(patchCalls(fetchMock)).toHaveLength(2);
    expect(listReloadCount(fetchMock)).toBe(1);
    expect(screen.getByRole("form", { name: "Edit grace@example.com" })).toBeInTheDocument();
  }, 10_000);

  it("PATCH 401 with a failed refresh (dead session): the auth gate takes over, panel never shows", async () => {
    const fetchMock = stubApi({
      refreshFailAfterFirst: true,
      patch: () => ({
        response: jsonResponse(401, {
          error: { code: "UNAUTHENTICATED", message: "expired" },
        }),
      }),
    });

    await openEditPanelForGrace();
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    // Session died: the auth gate replaces the page with its redirect state…
    expect(await screen.findByText("Redirecting to login…")).toBeInTheDocument();
    // …and the one-time password panel never appears.
    expect(screen.queryByText("Share this password now")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(listReloadCount(fetchMock)).toBe(1);
  });

  it("PATCH success: the one-time panel shows and the saved effect fires exactly once", async () => {
    const UPDATED_GRACE = makeUser({ ...USER_GRACE, must_change_password: true });
    const fetchMock = stubApi({
      patch: () => ({
        response: jsonResponse(200, { data: UPDATED_GRACE }),
        appliedUser: UPDATED_GRACE,
      }),
    });

    await openEditPanelForGrace();
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("Share this password now")).toBeInTheDocument();
    // The address appears both in the reloaded table row and inside the panel.
    const mentions = screen.getAllByText("grace@example.com");
    expect(mentions.length).toBeGreaterThanOrEqual(2);

    // Edit panel closed; the single onSaved reloaded the list exactly once,
    // and the reload reflects the PATCH result (temp-password badge).
    expect(
      screen.queryByRole("form", { name: "Edit grace@example.com" })
    ).not.toBeInTheDocument();
    expect(await screen.findByText("temp password")).toBeInTheDocument();
    expect(listReloadCount(fetchMock)).toBe(2);
    expect(patchCalls(fetchMock)).toHaveLength(1);
  });
});

describe("EditUserPanel plain save", () => {
  it("save failure keeps the edit form open and never shows a one-time panel", async () => {
    const fetchMock = stubApi({
      patch: () => ({
        response: jsonResponse(409, {
          error: { code: "CONFLICT", message: "No active admin would remain." },
        }),
      }),
    });

    await openEditPanelForGrace();
    fireEvent.change(editFormNameField(), { target: { value: "Grace B. Hopper" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No active admin would remain."
    );
    expect(screen.getByRole("form", { name: "Edit grace@example.com" })).toBeInTheDocument();
    expect(screen.queryByText("Share this password now")).not.toBeInTheDocument();
    expect(listReloadCount(fetchMock)).toBe(1);
  });

  it("save success closes the edit form and reloads exactly once, with no one-time panel", async () => {
    const RENAMED = makeUser({ ...USER_GRACE, name: "Grace B. Hopper" });
    const fetchMock = stubApi({
      patch: () => ({
        response: jsonResponse(200, { data: RENAMED }),
        appliedUser: RENAMED,
      }),
    });

    await openEditPanelForGrace();
    fireEvent.change(editFormNameField(), { target: { value: "Grace B. Hopper" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("cell", { name: "Grace B. Hopper" })).toBeInTheDocument();
    expect(
      screen.queryByRole("form", { name: "Edit grace@example.com" })
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Share this password now")).not.toBeInTheDocument();
    expect(listReloadCount(fetchMock)).toBe(2);
  });
});
