import { ApiError, ApiErrorBody } from "./api-error";
import { Page, PaginationMeta } from "./api-types";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

/**
 * Everything apiFetch needs to manage the access token across a refresh race:
 * getters/setters plus the refresh+retry hook supplied by the auth layer.
 * A plain module-level token store would leak between tests and between
 * logged-out users on a shared tab; this keeps the client stateless.
 */
export interface ApiClientDeps {
  getToken(): string | null;
  setToken(token: string | null): void;
  /**
   * Perform a refresh. Returns the new access token or null when the session
   * is dead (refresh failed). Called at most once per apiFetch call.
   */
  refresh(): Promise<string | null>;
}

/** Transient failures worth one automatic retry. */
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(response: Response): number | undefined {
  const raw = response.headers.get("Retry-After");
  if (!raw) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? seconds : undefined;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /**
   * Multipart body for file uploads (attachments). When set it wins over
   * `body` and the request omits `Content-Type` so the browser adds the
   * multipart boundary itself.
   */
  formData?: FormData;
  /**
   * Query values. Arrays are sent as repeated parameters
   * (`priority=high&priority=medium`) — the contract's shape for the
   * repeatable case filters.
   */
  query?: Record<
    string,
    string | number | boolean | ReadonlyArray<string | number> | undefined
  >;
  signal?: AbortSignal;
  /**
   * Internal: the refresh call itself must not trigger another refresh from
   * the 401 interceptor (would recurse/deadlock with the in-flight dedup).
   */
  skipAuthRetry?: boolean;
}

function buildUrl(base: string, path: string, query: RequestOptions["query"]): string {
  const qs = new URLSearchParams();
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      // Repeatable parameters (priority/type/tag) use append, not set.
      if (Array.isArray(value)) {
        for (const item of value) qs.append(key, String(item));
      } else {
        qs.set(key, String(value));
      }
    }
  }
  const search = qs.toString();
  return `${base}${path}${search ? `?${search}` : ""}`;
}

export function createApiClient(deps: ApiClientDeps) {
  /**
   * One HTTP cycle: sends credentials: "include" (refresh cookie), unwraps the
   * {data} / {data, meta} envelope, throws ApiError from the contract error
   * shape. `withMeta` selects the paginated-list return shape.
   */
  async function requestOnce<T>(
    path: string,
    options: RequestOptions,
    withMeta: boolean
  ): Promise<T | Page<T[]>> {
    const token = deps.getToken();
    const url = buildUrl(API_BASE_URL, path, options.query);
    const method = options.method ?? "GET";
    // A multipart body must not carry a JSON Content-Type — fetch would
    // otherwise be unable to add its own multipart boundary.
    const isMultipart = options.formData !== undefined;

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        credentials: "include", // refresh cookie rides along on every call
        headers: {
          ...(isMultipart ? {} : { "Content-Type": "application/json" }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: isMultipart
          ? options.formData
          : options.body !== undefined
            ? JSON.stringify(options.body)
            : undefined,
        signal: options.signal,
      });
    } catch {
      if (options.signal?.aborted) {
        throw new ApiError({
          code: "REQUEST_FAILED",
          message: "Request aborted.",
          status: 0,
        });
      }
      throw new ApiError({
        code: "REQUEST_FAILED",
        message: "Cannot reach the server. Check your connection and try again.",
        status: 0,
      });
    }

    // 204 No Content has no body per the conventions.
    if (response.status === 204) {
      return undefined as T;
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ApiError({
        code: "REQUEST_FAILED",
        message: "Server returned a malformed response.",
        status: response.status,
      });
    }

    if (!response.ok) {
      const body = payload as Partial<ApiErrorBody> | null;
      const err = body?.error;
      throw new ApiError({
        code: err?.code ?? "REQUEST_FAILED",
        message: err?.message ?? "Something went wrong. Please try again.",
        status: response.status,
        details: err?.details,
        retryAfterSeconds: parseRetryAfter(response),
      });
    }

    // unwrap { data } / { data, meta }
    const envelope = payload as { data?: unknown; meta?: unknown } | null;
    if (!envelope || typeof envelope !== "object" || !("data" in envelope)) {
      throw new ApiError({
        code: "REQUEST_FAILED",
        message: "Server response was missing the expected data envelope.",
        status: response.status,
      });
    }
    if (withMeta) {
      const meta =
        envelope.meta && typeof envelope.meta === "object"
          ? (envelope.meta as PaginationMeta)
          : undefined;
      return { data: envelope.data, meta } as Page<T[]>;
    }
    return envelope.data as T;
  }

  async function requestWithRetry<T>(
    path: string,
    options: RequestOptions,
    withMeta: boolean
  ): Promise<T | Page<T[]>> {
    const MAX_ATTEMPTS = 2;
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await requestOnce<T>(path, options, withMeta);
      } catch (err) {
        lastError = err;

        if (!(err instanceof ApiError)) throw err;
        if (attempt >= MAX_ATTEMPTS) throw err;

        if (err.status === 401) {
          // The refresh endpoint itself must never trigger another refresh
          // (skipAuthRetry) — a 401 there means the session is dead.
          if (options.skipAuthRetry) throw err;
          // 401-once-then-refresh-retry: exactly one refresh + retry per call.
          const newToken = await deps.refresh();
          if (!newToken) {
            // refresh failed → session is dead; surface the original 401
            throw err;
          }
          continue; // retry once with the fresh token
        }

        if (RETRY_STATUSES.has(Number(err.status))) {
          // transient failure: one retry with backoff (honour Retry-After on 429)
          const backoffMs = err.retryAfterSeconds
            ? Math.min(err.retryAfterSeconds, 30) * 1000
            : 500;
          await sleep(backoffMs);
          continue;
        }

        throw err;
      }
    }
    throw lastError;
  }

  /** Unwraps `{ data }` and returns it. Throws typed ApiError on failure. */
  async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return (await requestWithRetry<T>(path, options, false)) as T;
  }

  /** Unwraps `{ data, meta }` for paginated lists. */
  async function apiFetchPage<T>(
    path: string,
    options: RequestOptions = {}
  ): Promise<Page<T[]>> {
    return (await requestWithRetry<T>(path, options, true)) as Page<T[]>;
  }

  /**
   * Fetches binary bytes (attachments) and returns them as a Blob. Split from
   * the envelope path because the response is not JSON; a 401 still refreshes
   * once and retries so a streamed file respects the access token.
   */
  async function apiFetchBlob(
    path: string,
    options: RequestOptions = {}
  ): Promise<Blob> {
    const token = deps.getToken();
    const url = buildUrl(API_BASE_URL, path, options.query);

    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method ?? "GET",
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: options.signal,
      });
    } catch {
      throw new ApiError({
        code: "REQUEST_FAILED",
        message: "Cannot reach the server. Check your connection and try again.",
        status: 0,
      });
    }

    if (!response.ok) {
      if (response.status === 401 && !options.skipAuthRetry) {
        const newToken = await deps.refresh();
        if (newToken) {
          return apiFetchBlob(path, { ...options, skipAuthRetry: true });
        }
      }
      let code = "REQUEST_FAILED";
      let message = "Something went wrong. Please try again.";
      try {
        const body = (await response.json()) as Partial<ApiErrorBody> | null;
        code = body?.error?.code ?? code;
        message = body?.error?.message ?? message;
      } catch {
        // A non-JSON error body (e.g. an HTML gateway page) — keep the default.
      }
      throw new ApiError({ code, message, status: response.status });
    }

    return await response.blob();
  }

  return { apiFetch, apiFetchPage, apiFetchBlob };
}

export type ApiClient = ReturnType<typeof createApiClient>;
