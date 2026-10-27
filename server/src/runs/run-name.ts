import { ApiError } from '../errors';

/** Message shared by every run-name conflict, so callers can re-key it safely. */
export const RUN_NAME_CONFLICT_MESSAGE = 'A run with this name already exists.';

/**
 * 409 for a duplicate live run name in the project (docs/api-runs.md §
 * Validation). `field` is the API's detail key: `name` for a plain run, or
 * `runs[i].name` when the run is one of a plan's embedded runs.
 */
export function runNameConflict(field = 'name'): ApiError {
  return new ApiError('CONFLICT', RUN_NAME_CONFLICT_MESSAGE, [
    { field, issue: 'already in use' },
  ]);
}

/**
 * True for the 409 a duplicate run name raises. PlansService uses it to re-key
 * the store's `name` error to `runs[i].name`, since the store inserts runs one
 * at a time and does not know the request's index.
 */
export function isRunNameConflict(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.code === 'CONFLICT' &&
    error.message === RUN_NAME_CONFLICT_MESSAGE
  );
}