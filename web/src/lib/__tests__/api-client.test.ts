import { createApiClient, ApiClientDeps } from "../api-client";
import { ApiError } from "../api-error";

/** Fresh Response per call: bodies are stream-once and cannot be reused. */
function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const ok = (body: unknown) => jest.fn().mockImplementation(() => Promise.resolve(jsonResponse(200, { data: body })));

/**
 * Mirrors the production wiring: the refresh routine updates the same token
 * store that getToken reads (in the app: endpoints.setAccessToken).
 */
function makeDeps(
  overrides: Partial<ApiClientDeps> = {}
): ApiClientDeps & { refresh: jest.Mock } {
  let token: string | null = "token-1";
  return {
    getToken: jest.fn(() => token),
    setToken: jest.fn((t: string | null) => {
      token = t;
    }),
    refresh: jest.fn(async () => {
      token = "token-2";
      return "token-2";
    }),
    ...overrides,
  } as ApiClientDeps & { refresh: jest.Mock };
}

const USER = { id: "u1", email: "a@b.c", name: "Ada", role: "admin" };

describe("api client — envelopes", () => {
  afterEach(() => jest.useRealTimers());

  it("unwraps the { data } envelope", async () => {
    global.fetch = ok(USER) as unknown as typeof fetch;
    const client = createApiClient(makeDeps());
    await expect(client.apiFetch("/auth/me")).resolves.toEqual(USER);
  });

  it("unwraps { data, meta } for paginated lists", async () => {
    const meta = { page: 1, limit: 25, total: 1, total_pages: 1 };
    global.fetch = jest
      .fn()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse(200, { data: [USER], meta }))
      ) as unknown as typeof fetch;
    const client = createApiClient(makeDeps());
    await expect(client.apiFetchPage("/users")).resolves.toEqual({
      data: [USER],
      meta,
    });
  });

  it("returns undefined on 204 No Content without parsing a body", async () => {
    global.fetch = jest
      .fn()
      .mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
    const client = createApiClient(makeDeps());
    await expect(
      client.apiFetch("/auth/logout", { method: "POST" })
    ).resolves.toBeUndefined();
  });

  it("sends credentials, JSON content type and bearer token", async () => {
    const fetchMock = ok(USER);
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = createApiClient(makeDeps());
    await client.apiFetch("/auth/me");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("http://localhost:3001/api/v1/auth/me");
    expect(init.credentials).toBe("include");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers.Authorization).toBe("Bearer token-1");
  });

  it("serializes query params and omits undefined ones", async () => {
    const fetchMock = ok([]);
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = createApiClient(makeDeps());
    await client.apiFetchPage("/users", {
      query: { query: "grace", role: "admin", page: 2, limit: undefined },
    });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("query=grace");
    expect(url).toContain("role=admin");
    expect(url).toContain("page=2");
    expect(url).not.toContain("limit");
  });

  it("omits the Authorization header when there is no token and sends snake_case bodies", async () => {
    const fetchMock = ok(USER);
    global.fetch = fetchMock as unknown as typeof fetch;
    const deps = makeDeps({
      getToken: jest.fn(() => null),
      refresh: jest.fn(async () => null),
    });
    const client = createApiClient(deps);
    await client.apiFetch("/auth/login", {
      method: "POST",
      body: { email: "a@b.c", password: "pw" },
    });
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers.Authorization).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({ email: "a@b.c", password: "pw" });
  });
});

describe("api client — error handling", () => {
  it("throws a typed ApiError from the { error } envelope", async () => {
    global.fetch = jest
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          jsonResponse(409, {
            error: {
              code: "CONFLICT",
              message: "email already exists",
              details: [{ field: "email", issue: "already exists" }],
            },
          })
        )
      ) as unknown as typeof fetch;
    const client = createApiClient(makeDeps());
    const promise = client.apiFetch("/users", { method: "POST", body: {} });
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await promise.catch((err: ApiError) => {
      expect(err.code).toBe("CONFLICT");
      expect(err.status).toBe(409);
      expect(err.message).toBe("email already exists");
      expect(err.details).toEqual([{ field: "email", issue: "already exists" }]);
    });
  });

  it("maps network failures to REQUEST_FAILED with status 0", async () => {
    global.fetch = jest
      .fn()
      .mockImplementation(() => Promise.reject(new TypeError("fetch failed")));
    const client = createApiClient(makeDeps());
    await expect(client.apiFetch("/auth/me")).rejects.toMatchObject({
      code: "REQUEST_FAILED",
      status: 0,
    });
  });

  it("maps a non-JSON success body to REQUEST_FAILED", async () => {
    global.fetch = jest
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response("<html>oops</html>", { status: 200 }))
      );
    const client = createApiClient(makeDeps());
    await expect(client.apiFetch("/auth/me")).rejects.toMatchObject({
      code: "REQUEST_FAILED",
    });
  });

  it("rejects contract-shaped 200 responses missing the data envelope", async () => {
    global.fetch = jest
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(200, { hello: true })));
    const client = createApiClient(makeDeps());
    await expect(client.apiFetch("/auth/me")).rejects.toMatchObject({
      code: "REQUEST_FAILED",
    });
  });

  it("keeps a fallback message when the error body is not contract-shaped", async () => {
    global.fetch = jest
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(500, { nope: true })));
    const client = createApiClient(makeDeps());
    await expect(client.apiFetch("/auth/me")).rejects.toMatchObject({
      code: "REQUEST_FAILED",
      status: 500,
    });
  });
});

describe("api client — 401 once then refresh + retry", () => {
  const expired401 = () =>
    jsonResponse(401, { error: { code: "UNAUTHENTICATED", message: "expired" } });

  it("refreshes exactly once and retries with the new token", async () => {
    const fetchMock = jest
      .fn()
      .mockImplementationOnce(() => Promise.resolve(expired401()))
      .mockImplementationOnce(() => Promise.resolve(jsonResponse(200, { data: USER })));
    global.fetch = fetchMock as unknown as typeof fetch;
    const deps = makeDeps();
    const client = createApiClient(deps);

    await expect(client.apiFetch("/auth/me")).resolves.toEqual(USER);
    expect(deps.refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer token-2");
  });

  it("throws the original 401 when refresh fails (no retry, no loop)", async () => {
    const fetchMock = jest
      .fn()
      .mockImplementation(() => Promise.resolve(expired401()));
    global.fetch = fetchMock as unknown as typeof fetch;
    const deps = makeDeps({ refresh: jest.fn(async () => null) });
    const client = createApiClient(deps);

    await expect(client.apiFetch("/auth/me")).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHENTICATED",
    });
    expect(deps.refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not loop when the retried request 401s again", async () => {
    const fetchMock = jest
      .fn()
      .mockImplementation(() => Promise.resolve(expired401()));
    global.fetch = fetchMock as unknown as typeof fetch;
    const deps = makeDeps();
    const client = createApiClient(deps);

    await expect(client.apiFetch("/auth/me")).rejects.toBeInstanceOf(ApiError);
    expect(deps.refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a 401 with skipAuthRetry does not refresh or retry (refresh endpoint itself)", async () => {
    const fetchMock = jest
      .fn()
      .mockImplementation(() => Promise.resolve(expired401()));
    global.fetch = fetchMock as unknown as typeof fetch;
    const deps = makeDeps();
    const client = createApiClient(deps);

    await expect(
      client.apiFetch("/auth/refresh", { method: "POST", skipAuthRetry: true })
    ).rejects.toMatchObject({ status: 401 });
    expect(deps.refresh).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not refresh-and-retry for non-401 errors", async () => {
    global.fetch = jest
      .fn()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse(403, { error: { code: "FORBIDDEN", message: "no" } }))
      );
    const deps = makeDeps();
    const client = createApiClient(deps);
    await expect(client.apiFetch("/users")).rejects.toMatchObject({ status: 403 });
    expect(deps.refresh).not.toHaveBeenCalled();
  });
});

describe("api client — transient retry with backoff", () => {
  it("retries 429 once and honours Retry-After (capped)", async () => {
    jest.useFakeTimers();
    const fetchMock = jest
      .fn()
      .mockImplementationOnce(() =>
        Promise.resolve(
          jsonResponse(
            429,
            { error: { code: "RATE_LIMITED", message: "slow down" } },
            { "Retry-After": "2" }
          )
        )
      )
      .mockImplementationOnce(() => Promise.resolve(jsonResponse(200, { data: USER })));
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = createApiClient(makeDeps());

    const promise = client.apiFetch("/auth/login", { method: "POST", body: {} });
    await jest.advanceTimersByTimeAsync(2_100);
    await expect(promise).resolves.toEqual(USER);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries 503 once with the default backoff", async () => {
    jest.useFakeTimers();
    const fetchMock = jest
      .fn()
      .mockImplementationOnce(() =>
        Promise.resolve(jsonResponse(503, { error: { code: "INTERNAL", message: "down" } }))
      )
      .mockImplementationOnce(() => Promise.resolve(jsonResponse(200, { data: USER })));
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = createApiClient(makeDeps());

    const promise = client.apiFetch("/auth/me");
    await jest.advanceTimersByTimeAsync(600);
    await expect(promise).resolves.toEqual(USER);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces the error after the single retry keeps failing", async () => {
    jest.useFakeTimers();
    global.fetch = jest
      .fn()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse(500, { error: { code: "INTERNAL", message: "down" } }))
      );
    const client = createApiClient(makeDeps());
    const promise = client.apiFetch("/auth/me");
    // Attach the rejection handler before the retry cycle runs so the
    // intermediate rejection is never "unhandled".
    const assertion = expect(promise).rejects.toMatchObject({
      status: 500,
      code: "INTERNAL",
    });
    await jest.advanceTimersByTimeAsync(1_000);
    await assertion;
  });

  it("does not retry 4xx client errors like 400", async () => {
    const fetchMock = jest
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          jsonResponse(400, { error: { code: "VALIDATION_ERROR", message: "bad" } })
        )
      );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = createApiClient(makeDeps());
    await expect(
      client.apiFetch("/auth/login", { method: "POST", body: {} })
    ).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
