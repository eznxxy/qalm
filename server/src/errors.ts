/**
 * Shared error envelope, docs/api-conventions.md § Error format:
 *   { "error": { "code": "...", "message": "...", "details"?: [...] } }
 * Codes are fixed by the contract; HTTP status is derived from the code.
 * JSON keys are snake_case.
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export interface ValidationErrorDetail {
  field: string;
  issue: string;
}

export interface ErrorEnvelopeBody {
  code: ErrorCode;
  message: string;
  details?: ValidationErrorDetail[];
}

export interface ErrorEnvelope {
  error: ErrorEnvelopeBody;
}

export const HTTP_STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

/** Thrown anywhere in the app to produce a contract-shaped error response. */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: ValidationErrorDetail[],
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get status(): number {
    return HTTP_STATUS_BY_CODE[this.code];
  }

  toEnvelope(): ErrorEnvelope {
    const body: ErrorEnvelopeBody = { code: this.code, message: this.message };
    if (this.details && this.details.length > 0) {
      body.details = this.details;
    }
    return { error: body };
  }
}
