/** Known error.code values from docs/api-conventions.md. */
export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL"
  /** client-side failures: network down, non-JSON body, malformed envelope */
  | "REQUEST_FAILED";

export interface ApiErrorDetail {
  field?: string;
  issue: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: ApiErrorDetail[];
  };
}

/**
 * Typed error thrown by the API client. `status` is 0 when the request never
 * got a contract-shaped HTTP response (network error, non-JSON body, ...).
 * `retryAfterSeconds` is set from the Retry-After header on 429.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode | string;
  readonly status: number;
  readonly details?: ApiErrorDetail[];
  readonly retryAfterSeconds?: number;

  constructor(args: {
    code: ApiErrorCode | string;
    message: string;
    status: number;
    details?: ApiErrorDetail[];
    retryAfterSeconds?: number;
  }) {
    super(args.message);
    this.name = "ApiError";
    this.code = args.code;
    this.status = args.status;
    this.details = args.details;
    this.retryAfterSeconds = args.retryAfterSeconds;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
