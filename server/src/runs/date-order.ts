import { ApiError } from '../errors';

/**
 * `start_date` and `due_date` are independent optional dates, except that a run
 * may not start after it is due (docs/api-runs.md § Validation). Both are plain
 * `YYYY-MM-DD` strings, so a lexical comparison is a date comparison.
 *
 * `field` is the detail field the 400 names: `start_date` for a run endpoint,
 * `runs[2].start_date` when the run is nested in a plan create
 * (docs/api-plans.md § POST).
 */
export function assertDateOrder(
  startDate: string | null,
  dueDate: string | null,
  field = 'start_date',
): void {
  if (startDate === null || dueDate === null) return;
  if (startDate <= dueDate) return;
  throw new ApiError('VALIDATION_ERROR', 'Request validation failed.', [
    { field, issue: 'must be on or before due_date' },
  ]);
}