import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { ApiError } from "../../lib/api-error";
import { sanitizeNextPath } from "../login-form";

/**
 * Regression tests for the ?next= redirect hardening (open-redirect fix).
 *
 * The module-level next/navigation mock from jest.setup.ts is overridden here
 * so each case controls `?next=` itself and can assert what LoginForm asked
 * the router to replace with. The session hook is mocked: login() flips the
 * shared sessionState to authenticated (the session lib owns no redirect of
 * its own), or rejects with a real ApiError for the failure-path test.
 */
jest.mock("next/navigation", () => {
  const searchParams = new URLSearchParams();
  const replace = jest.fn();
  return {
    __setNext: (raw: string | null) => {
      searchParams.delete("next");
      if (raw !== null) searchParams.set("next", raw);
    },
    __getReplace: () => replace,
    useRouter: () => ({ replace, push: jest.fn(), back: jest.fn(), prefetch: jest.fn() }),
    usePathname: () => "/login",
    useSearchParams: () => searchParams,
  };
});

const { __setNext, __getReplace } = jest.requireMock("next/navigation") as {
  __setNext: (raw: string | null) => void;
  __getReplace: () => jest.Mock;
};

const sessionState = {
  status: "unauthenticated" as "loading" | "authenticated" | "unauthenticated",
  user: null as Record<string, unknown> | null,
};

const loginBehavior = { fail: false };

jest.mock("../../lib/session", () => ({
  useSession: () => ({
    ...sessionState,
    login: jest.fn(() => {
      if (loginBehavior.fail) {
        return Promise.reject(
          new ApiError({
            code: "UNAUTHENTICATED",
            message: "Invalid credentials",
            status: 401,
          })
        );
      }
      sessionState.status = "authenticated";
      sessionState.user = { id: "u-1", must_change_password: false };
      return Promise.resolve();
    }),
    bootstrap: jest.fn(),
    logout: jest.fn(),
    refresh: jest.fn(),
  }),
  SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

/** Admin user modelled on the API contract (docs/api-auth.md). */
const ADMIN = {
  id: "u-1",
  email: "ada@example.com",
  name: "Ada Lovelace",
  role: "admin",
  is_active: true,
  must_change_password: false,
};

describe("sanitizeNextPath — same-origin redirect allowlist", () => {
  it.each([
    [null, "/"],
    [undefined, "/"],
    ["", "/"],
    ["//evil.com", "/"],
    ["///evil.com", "/"],
    ["\\evil.com", "/"],
    ["https://evil.com", "/"],
    ["http:/evil.com", "/"],
    ["javascript:alert(1)", "/"],
    ["%2F%2Fevil.com", "/"],
  ])("rejects %j → %j", (raw, expected) => {
    expect(sanitizeNextPath(raw)).toBe(expected);
  });

  it.each(["/", "/users", "/change-password", "/projects?tab=runs#/detail"])(
    "accepts the in-app path %j",
    (path) => {
      expect(sanitizeNextPath(path)).toBe(path);
    }
  );
});

describe("LoginForm — ?next= redirect behavior", () => {
  beforeEach(() => {
    __setNext(null);
    sessionState.status = "unauthenticated";
    sessionState.user = null;
    loginBehavior.fail = false;
    __getReplace().mockClear();
  });

  async function submitLogin() {
    const { LoginForm } = await import("../login-form");
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "sup3rs3cret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    await waitFor(() => {
      expect(
        __getReplace().mock.calls.length > 0 || screen.queryByRole("alert")
      ).toBeTruthy();
    });
  }

  it("redirects to the in-app path when ?next=/users", async () => {
    __setNext("/users");
    await submitLogin();
    await waitFor(() => expect(__getReplace()).toHaveBeenCalledWith("/users"));
  });

  it("never sends the user off-site: ?next=//example.com lands on /", async () => {
    __setNext("//example.com");
    await submitLogin();
    await waitFor(() => expect(__getReplace()).toHaveBeenCalledWith("/"));
    expect(__getReplace()).not.toHaveBeenCalledWith("//example.com");
  });

  it.each(["https://evil.example", "\\evil.example", "///evil.example"])(
    "falls back to / for hostile ?next=%s",
    async (hostile) => {
      __setNext(hostile);
      await submitLogin();
      await waitFor(() => expect(__getReplace()).toHaveBeenCalledWith("/"));
      expect(__getReplace()).not.toHaveBeenCalledWith(hostile);
    }
  );

  it("redirects to / by default when ?next is absent", async () => {
    await submitLogin();
    await waitFor(() => expect(__getReplace()).toHaveBeenCalledWith("/"));
  });

  it("already-authenticated render follows the sanitized ?next only", async () => {
    __setNext("//example.com");
    sessionState.status = "authenticated";
    sessionState.user = ADMIN;
    const { LoginForm } = await import("../login-form");
    render(<LoginForm />);
    await waitFor(() => expect(__getReplace()).toHaveBeenCalledWith("/"));
    expect(__getReplace()).not.toHaveBeenCalledWith("//example.com");
  });

  it("a failed login redirects nowhere; a later success still sanitizes", async () => {
    __setNext("//example.com");
    loginBehavior.fail = true;

    const { LoginForm } = await import("../login-form");
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "wrong-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid email or password."
    );
    expect(__getReplace()).not.toHaveBeenCalled();

    // Successful retry (mock flips back to success) keeps the sanitized path.
    loginBehavior.fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    await waitFor(() => expect(__getReplace()).toHaveBeenCalledWith("/"));
    expect(__getReplace()).not.toHaveBeenCalledWith("//example.com");
  });
});
