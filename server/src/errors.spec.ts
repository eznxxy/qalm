import { ApiError, ErrorCode, HTTP_STATUS_BY_CODE } from './errors';

describe('error envelope', () => {
  it('exposes exactly the contract error codes', () => {
    expect(Object.keys(HTTP_STATUS_BY_CODE).sort()).toEqual(
      [
        'CONFLICT',
        'FORBIDDEN',
        'INTERNAL',
        'NOT_FOUND',
        'RATE_LIMITED',
        'UNAUTHENTICATED',
        'VALIDATION_ERROR',
      ].sort(),
    );
  });

  it('maps codes to the contract HTTP statuses', () => {
    expect(HTTP_STATUS_BY_CODE).toEqual({
      VALIDATION_ERROR: 400,
      UNAUTHENTICATED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
      RATE_LIMITED: 429,
      INTERNAL: 500,
    });
  });

  it('wraps errors as { error: { code, message } } with snake_case keys', () => {
    const error = new ApiError('NOT_FOUND', 'Project not found.');
    expect(error.toEnvelope()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Project not found.' },
    });
    expect(Object.keys(error.toEnvelope())).toEqual(['error']);
  });

  it('omits details when absent', () => {
    const body = new ApiError('CONFLICT', 'Duplicate key.').toEnvelope();
    expect('details' in body.error).toBe(false);
  });

  it('carries validation details as [{field, issue}]', () => {
    const error = new ApiError('VALIDATION_ERROR', 'Request validation failed.', [
      { field: 'email', issue: 'must be a valid email address' },
      { field: 'key', issue: 'must match ^[A-Z][A-Z0-9]*$' },
    ]);
    expect(error.toEnvelope()).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed.',
        details: [
          { field: 'email', issue: 'must be a valid email address' },
          { field: 'key', issue: 'must match ^[A-Z][A-Z0-9]*$' },
        ],
      },
    });
  });

  it('derives status from the code', () => {
    const cases: Array<[ErrorCode, number]> = [
      ['VALIDATION_ERROR', 400],
      ['UNAUTHENTICATED', 401],
      ['FORBIDDEN', 403],
      ['NOT_FOUND', 404],
      ['CONFLICT', 409],
      ['RATE_LIMITED', 429],
      ['INTERNAL', 500],
    ];
    for (const [code, status] of cases) {
      expect(new ApiError(code, 'msg').status).toBe(status);
    }
  });
});
