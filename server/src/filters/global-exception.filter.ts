import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Response } from 'express';
import { ApiError, ErrorCode, ValidationErrorDetail } from '../errors';

export interface ErrorResponseBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: ValidationErrorDetail[];
  };
}

const KNOWN_CODES: readonly string[] = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL',
];

function isKnownCode(value: string): value is ErrorCode {
  return KNOWN_CODES.includes(value);
}

export function defaultCodeForStatus(status: number): ErrorCode {
  // TS 5: numbers are assignable to numeric enum types.
  const statusEnum: HttpStatus = status;
  switch (statusEnum) {
    case HttpStatus.BAD_REQUEST:
      return 'VALIDATION_ERROR';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHENTICATED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'RATE_LIMITED';
    default:
      return 'INTERNAL';
  }
}

interface TranslatedError {
  body: ErrorResponseBody;
  status: number;
  headers: Record<string, string>;
}

/**
 * Translates HTTP-exception-shaped errors (Nest built-ins, guards, pipes not
 * covered by our validation pipe) into the shared envelope.
 */
export function envelopeForHttpException(exception: HttpException): TranslatedError {
  const status = exception.getStatus();
  const response = exception.getResponse();

  let code: ErrorCode | undefined;
  let message: string | undefined;
  let details: ValidationErrorDetail[] | undefined;

  if (typeof response === 'string') {
    message = response;
  } else if (typeof response === 'object' && response !== null) {
    const obj = response as Record<string, unknown>;
    const candidateCode = obj['code'];
    if (typeof candidateCode === 'string' && isKnownCode(candidateCode)) {
      code = candidateCode;
    }
    const candidateMessage = obj['message'];
    if (typeof candidateMessage === 'string') {
      message = candidateMessage;
    } else if (Array.isArray(candidateMessage)) {
      const messages = candidateMessage.map((m) => String(m));
      message = messages.join('; ');
    }
    const candidateDetails = obj['details'];
    if (Array.isArray(candidateDetails)) {
      details = candidateDetails as ValidationErrorDetail[];
    }
  }

  if (code === undefined) {
    code = defaultCodeForStatus(status);
  }
  if (message === undefined) {
    message = exception.message;
  }

  const headers: Record<string, string> = {};
  if (code === 'RATE_LIMITED') {
    // api-conventions.md: 429 carries Retry-After in seconds.
    const retryAfter = (response as Record<string, unknown> | null)?.['retryAfter'];
    if (typeof retryAfter === 'number' || typeof retryAfter === 'string') {
      headers['Retry-After'] = String(retryAfter);
    }
  }

  const body: ErrorResponseBody = { error: { code, message } };
  if (details && details.length > 0) {
    body.error.details = details;
  }
  return { body, status, headers };
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.adapterHost;
    const response = host.switchToHttp().getResponse<Response>();

    let translated: TranslatedError;
    if (exception instanceof ApiError) {
      translated = {
        body: exception.toEnvelope(),
        status: exception.status,
        headers: {},
      };
    } else if (exception instanceof HttpException) {
      translated = envelopeForHttpException(exception);
    } else {
      // Unknown failure: log for the on-call, never leak internals to clients.
      const message =
        exception instanceof Error ? exception.message : String(exception);
      const stack = exception instanceof Error ? exception.stack : undefined;
      this.logger.error(`Unhandled exception: ${message}`, stack);
      translated = {
        body: { error: { code: 'INTERNAL', message: 'Internal server error.' } },
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        headers: {},
      };
    }

    for (const [name, value] of Object.entries(translated.headers)) {
      httpAdapter.setHeader(response, name, value);
    }
    httpAdapter.reply(response, translated.body, translated.status);
  }
}
