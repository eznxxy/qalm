import { act, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { SessionProvider, useSession } from "../session";
import { api, setAccessToken, setRefreshHandler, getAccessToken } from "../endpoints";
import { ApiError } from "../api-error";
import type { User } from "../api-types";

const USER_ADA: User = {
  id: "u-1",
  email: "ada@example.com",
  name: "Ada Lovelace",
  role: "admin",
  is_active: true,
  must_change_password: false,
  created_at: "2026-10-07T12:00:00Z",
  updated_at: "2026-10-07T12:00:00Z",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const loginData = (user: User = USER_ADA, expiresIn = 900) => ({
  data: {
    user,
    access_token: "tok-login",
    token_type: "Bearer",
    expires_in: expiresIn,
  },
});

const refreshData = (expiresIn = 900) => ({
  data: {
    access_token: `tok-${Math.random().toString(36).slice(2, 8)}`,
    token_type: "Bearer",
    expires_in: expiresIn,
  },
});

const unauth401 = () =>
  jsonResponse(401, { error: { code: "UNAUTHENTICATED", message: "no cookie" } });

type Ctx = {
  status: string;
  user: User | null;
  login: (email: string, password: string) => Promise<User>;
  bootstrap: (c: { name: string; email: string; password: string }) => Promise<User>;
  logout: () => Promise<void>;
};

describe("SessionProvider", () => {
  let fetchMock: jest.Mock;
  const ctxRef: { current: Ctx | null } = { current: null };

  function Harness() {
    const ctx = useSession();
    ctxRef.current = ctx;
    return (
      <div>
        <span data-testid="status">{ctx.status}</span>
        <span data-testid="user">
          {ctx.user ? `${ctx.user.email}:${ctx.user.role}` : "none"}
        </span>
      </div>
    );
  }

  function renderSession() {
    return render(
      <SessionProvider>
        <Harness />
      </SessionProvider>
    );
  }

  beforeEach(() => {
    // Reset endpoints module state without forking the module registry
    // (resetModules would create a second React + second ApiError class).
    setAccessToken(null);
    setRefreshHandler(async () => null);
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    ctxRef.current = null;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("starts loading, then lands unauthenticated when the refresh cookie is absent", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(unauth401()));
    renderSession();
    expect(screen.getByTestId("status")).toHaveTextContent("loading");
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated")
    );
    // Only the refresh was attempted; no /auth/me without a session.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/auth/refresh");
    expect(getAccessToken()).toBeNull();
  });

  it("restores the session on mount: refresh succeeds, then /auth/me loads the user", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/auth/refresh")) {
        return Promise.resolve(jsonResponse(200, refreshData()));
      }
      if (url.includes("/auth/me")) {
        return Promise.resolve(jsonResponse(200, { data: USER_ADA }));
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    renderSession();
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("authenticated")
    );
    expect(screen.getByTestId("user")).toHaveTextContent("ada@example.com:admin");
    // Token from refresh is in memory and rides on the Authorization header.
    expect(getAccessToken()).toMatch(/^tok-/);
    const meCall = fetchMock.mock.calls.find((c) => c[0].includes("/auth/me"));
    expect(meCall[1].headers.Authorization).toMatch(/^Bearer tok-/);
  });

  it("login stores the token, exposes the user, and posts snake_case credentials", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(unauth401()));
    renderSession();
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated")
    );

    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse(200, loginData()))
    );
    await act(async () => {
      const returned = await ctxRef.current!.login("ada@example.com", "s3cretpass");
      expect(returned.email).toBe("ada@example.com");
    });
    expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
    expect(screen.getByTestId("user")).toHaveTextContent("ada@example.com:admin");
    expect(getAccessToken()).toBe("tok-login");
    const loginCall = fetchMock.mock.calls.find((c) => c[0].includes("/auth/login"));
    expect(JSON.parse(loginCall[1].body)).toEqual({
      email: "ada@example.com",
      password: "s3cretpass",
    });
    // Public endpoint: no bearer header before login.
    expect(loginCall[1].headers.Authorization).toBeUndefined();
  });

  it("logout calls the endpoint, clears the user and the token", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(unauth401()));
    renderSession();
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated")
    );

    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse(200, loginData()))
    );
    await act(async () => {
      await ctxRef.current!.login("ada@example.com", "s3cretpass");
    });

    fetchMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
    await act(async () => {
      await ctxRef.current!.logout();
    });
    expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated");
    expect(screen.getByTestId("user")).toHaveTextContent("none");
    expect(getAccessToken()).toBeNull();
    const logoutCall = fetchMock.mock.calls.find((c) => c[0].includes("/auth/logout"));
    expect(logoutCall).toBeTruthy();
  });

  it("proactively refreshes at expires_in minus ~60s", async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation(() => Promise.resolve(unauth401()));
    renderSession();
    await act(async () => {
      await Promise.resolve();
    });
    expect(ctxRef.current!.status).toBe("unauthenticated");

    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse(200, loginData(USER_ADA, 900)))
    );
    await act(async () => {
      await ctxRef.current!.login("ada@example.com", "s3cretpass");
    });
    expect(ctxRef.current!.status).toBe("authenticated");

    fetchMock.mockClear();
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse(200, refreshData(900)))
    );

    // 900 - 60 = 840s delay; nothing before it.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(839_000);
    });
    expect(
      fetchMock.mock.calls.filter((c) => c[0].includes("/auth/refresh"))
    ).toHaveLength(0);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(2_000);
    });
    expect(
      fetchMock.mock.calls.filter((c) => c[0].includes("/auth/refresh"))
    ).toHaveLength(1);
    expect(ctxRef.current!.status).toBe("authenticated");
  });

  it("concurrent 401s trigger exactly one refresh (single-flight)", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(unauth401()));
    renderSession();
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated")
    );

    // Session exists server-side but the in-memory token is gone: slow
    // refresh (rotates the cookie), /auth/me 401s until the refresh lands.
    let refreshed = false;
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/auth/refresh")) {
        return new Promise((resolve) =>
          setTimeout(() => {
            refreshed = true;
            resolve(jsonResponse(200, refreshData()));
          }, 20)
        );
      }
      if (url.includes("/auth/me")) {
        return Promise.resolve(
          refreshed
            ? jsonResponse(200, { data: USER_ADA })
            : jsonResponse(401, {
                error: { code: "UNAUTHENTICATED", message: "expired" },
              })
        );
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });

    // Mount already consumed its refresh; count only what the concurrent
    // 401 burst produces.
    fetchMock.mockClear();

    let results: User[] = [];
    await act(async () => {
      results = await Promise.all([api.me(), api.me()]);
    });
    expect(results).toEqual([USER_ADA, USER_ADA]);
    const refreshCalls = fetchMock.mock.calls.filter((c) =>
      c[0].includes("/auth/refresh")
    );
    expect(refreshCalls).toHaveLength(1);
  });

  it("a failed refresh (interceptor path) drops the session to unauthenticated", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(unauth401()));
    renderSession();
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated")
    );

    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse(200, loginData(USER_ADA, 900)))
    );
    await act(async () => {
      await ctxRef.current!.login("ada@example.com", "s3cretpass");
    });
    expect(ctxRef.current!.status).toBe("authenticated");

    // Next authenticated call 401s and the refresh is rejected (e.g.
    // rotated-token replay) → the shared handler logs the session out.
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse(401, {
          error: { code: "UNAUTHENTICATED", message: "reused token" },
        })
      )
    );
    await act(async () => {
      await expect(api.me()).rejects.toBeInstanceOf(ApiError);
    });
    expect(ctxRef.current!.status).toBe("unauthenticated");
    expect(getAccessToken()).toBeNull();
  });
});

describe("login error contract", () => {
  it("bad credentials surface as UNAUTHENTICATED 401 ApiErrors (one generic UI message)", async () => {
    const fetchMock = jest.fn().mockImplementation(() =>
      Promise.resolve(
        jsonResponse(401, {
          error: { code: "UNAUTHENTICATED", message: "invalid credentials" },
        })
      )
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    setAccessToken(null);
    setRefreshHandler(async () => null);

    await expect(
      api.login({ email: "ghost@x.y", password: "whatever1" })
    ).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    await expect(
      api.login({ email: "ada@example.com", password: "wrongpass1" })
    ).rejects.toBeInstanceOf(ApiError);
    // The client must not loop on bad credentials.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
