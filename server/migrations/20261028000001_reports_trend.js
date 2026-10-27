/**
 * Migration — the trend query's supporting index.
 *
 * Contract: docs/api-project-overview.md § Implementation notes. The trend
 * starts from `results` restricted by `created_at` and joins back `run_items`
 * and `runs` by primary key, so a plain `created_at` index is the one that
 * matters. Additive only: no table, column or constraint changes, and nothing
 * is backfilled. `down` drops the index.
 */
exports.up = (pgm) => {
  pgm.createIndex('results', ['created_at'], { name: 'results_created_at_idx' });
};

exports.down = (pgm) => {
  pgm.dropIndex('results', ['created_at'], { name: 'results_created_at_idx' });
};