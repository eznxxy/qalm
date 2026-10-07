import { HttpException, HttpStatus } from '@nestjs/common';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ApiError } from '../errors';
import {
  defaultCodeForStatus,
  envelopeForHttpException,
  GlobalExceptionFilter,
} from './global-exception.filter';

describe('envelopeForHttpException', () => {
  it('maps a Nest NotFoundException to NOT_FOUND', () => {
    const { body, status } = envelopeForHttpException(new NotFoundException('missing'));
    expect(status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('missing');
  });

  it('maps a Nest ForbiddenException to FORBIDDEN', () => {
    const { body, status } = envelopeForHttpException(new ForbiddenException());
    expect(status).toBe(403);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('maps a Nest BadRequestException to VALIDATION_ERROR', () => {
    const { body, status } = envelopeForHttpException(new BadRequestException('bad'));
    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('passes through envelopes that already carry a contract code', () => {
    const exception = new HttpException(
      { code: 'CONFLICT', message: 'Email already exists.' },
      HttpStatus.CONFLICT,
    );
    const { body, status } = envelopeForHttpException(exception);
    expect(status).toBe(409);
    expect(body.error).toEqual({ code: 'CONFLICT', message: 'Email already exists.' });
  });

  it('joins class-validator message arrays into one message', () => {
    const exception = new HttpException(
      { statusCode: 400, message: ['email must be an email'] },
      HttpStatus.BAD_REQUEST,
    );
    const { body } = envelopeForHttpException(exception);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('email must be an email');
  });

  it('emits Retry-After for RATE_LIMITED when retryAfter is provided', () => {
    const exception = new HttpException(
      { code: 'RATE_LIMITED', message: 'Too many attempts.', retryAfter: 42 },
      HttpStatus.TOO_MANY_REQUESTS,
    );
    const { body, status, headers } = envelopeForHttpException(exception);
    expect(status).toBe(429);
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(headers['Retry-After']).toBe('42');
  });

  it('never includes a details key that is empty', () => {
    const exception = new HttpException(
      { code: 'VALIDATION_ERROR', message: 'x', details: [] },
      HttpStatus.BAD_REQUEST,
    );
    const { body } = envelopeForHttpException(exception);
    expect('details' in body.error).toBe(false);
  });
});

describe('defaultCodeForStatus', () => {
  it('covers the contract status range and defaults to INTERNAL', () => {
    expect(defaultCodeForStatus(400)).toBe('VALIDATION_ERROR');
    expect(defaultCodeForStatus(401)).toBe('UNAUTHENTICATED');
    expect(defaultCodeForStatus(403)).toBe('FORBIDDEN');
    expect(defaultCodeForStatus(404)).toBe('NOT_FOUND');
    expect(defaultCodeForStatus(409)).toBe('CONFLICT');
    expect(defaultCodeForStatus(429)).toBe('RATE_LIMITED');
    expect(defaultCodeForStatus(500)).toBe('INTERNAL');
    expect(defaultCodeForStatus(418)).toBe('INTERNAL');
  });
});

describe('GlobalExceptionFilter', () => {
  function makeHost(recorded: { body?: unknown; status?: number }): {
    getResponse: () => object;
  } & Record<string, unknown> {
    return {
      getResponse: () => ({
        status(code: number) {
          recorded.status = code;
          return this;
        },
        json(payload: unknown) {
          recorded.body = payload;
          return this;
        },
      }),
      getRequest: () => ({}),
      getNext: () => undefined,
    };
  }

  function run(exception: unknown): { body?: unknown; status?: number } {
    const recorded: { body?: unknown; status?: number } = {};
    const adapterHost = {
      httpAdapter: {
        setHeader: jest.fn(),
        reply: (response: { status(code: number): unknown; json(payload: unknown): unknown }, body: unknown, status: number) => {
          response.status(status);
          response.json(body);
        },
      },
    };
    const filter = new GlobalExceptionFilter(adapterHost as never);
    const host = makeHost(recorded);
    filter.catch(exception, {
      switchToHttp: () => host,
    } as never);
    return recorded;
  }

  it('renders ApiError into the contract envelope', () => {
    const { body, status } = run(new ApiError('CONFLICT', 'Email already exists.'));
    expect(status).toBe(409);
    expect(body).toEqual({
      error: { code: 'CONFLICT', message: 'Email already exists.' },
    });
  });

  it('renders unexpected errors as opaque INTERNAL', () => {
    const { body, status } = run(new Error('database password wrong'));
    expect(status).toBe(500);
    expect(body).toEqual({
      error: { code: 'INTERNAL', message: 'Internal server error.' },
    });
  });

  it('renders HttpExceptions through the shared translation', () => {
    const { body, status } = run(new NotFoundException('no such project'));
    expect(status).toBe(404);
    expect(body).toEqual({ error: { code: 'NOT_FOUND', message: 'no such project' } });
  });
});
