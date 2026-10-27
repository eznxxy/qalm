/**
 * Migration — runs: `start_date`.
 *
 * Contract: docs/api-runs.md § Resource: Run (`start_date`) and § Validation
 * (both dates optional, plain `YYYY-MM-DD`; when both are set the start date
 * may not be after the due date — enforced in RunsService, not here).
 *
 * Purely additive: a nullable `date` column, no backfill. Existing runs read
 * back `start_date = null`, exactly as before this migration, and the API
 * stores/returns it cast to text so it never timezone-shifts.
 *
 * Reversible: dropping the column restores the pre-3.5 shape.
 */
exports.up = (pgm) => {
  pgm.addColumn('runs', {
    start_date: { type: 'date' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('runs', 'start_date');
};