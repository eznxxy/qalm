/**
 * Migration — runs: one live name per project, case-insensitive.
 *
 * Contract: docs/api-runs.md § Validation (`name` unique per project) and
 * § Implementation notes (index), plus docs/api-plans.md for the runs created
 * with a plan — the same index covers them, because they are ordinary runs.
 *
 * A unique index cannot be created while duplicates exist, and the review
 * decision (2026-10-27) was to keep every row: the oldest run keeps the name,
 * later ones get " (2)", " (3)", … appended. No results or attachments move;
 * only `name` and `updated_at` change on the renamed rows. The suffix loop
 * checks the candidate against every live name in the project, so a rename can
 * never collide with a name that already ends that way.
 *
 * Partial on `deleted_at is null`, like plans: soft-deleting a run frees its
 * name for reuse (PRD decision 6 keeps deleted runs' results, not their names).
 *
 * Reversible in shape only: `down` drops the index and leaves the renamed rows
 * as they are — the original duplicates are not restorable, and guessing them
 * back would risk naming two runs the same again.
 */
exports.up = (pgm) => {
  pgm.sql(`
    DO $$
    DECLARE
      dup record;
      suffix integer;
      base text;
      candidate text;
    BEGIN
      FOR dup IN
        SELECT ranked.id, ranked.project_id, ranked.name
        FROM (
          SELECT r.id,
                 r.project_id,
                 r.name,
                 r.created_at,
                 row_number() OVER (
                   PARTITION BY r.project_id, lower(r.name)
                   ORDER BY r.created_at, r.id
                 ) AS rn
          FROM runs r
          WHERE r.deleted_at IS NULL
        ) ranked
        WHERE ranked.rn > 1
        ORDER BY ranked.project_id, lower(ranked.name), ranked.created_at, ranked.id
      LOOP
        -- 114 + " (999)" keeps the result inside the API's 120-char limit.
        base := left(btrim(dup.name), 114);
        suffix := 2;
        LOOP
          candidate := base || ' (' || suffix || ')';
          EXIT WHEN NOT EXISTS (
            SELECT 1
            FROM runs r
            WHERE r.project_id = dup.project_id
              AND r.deleted_at IS NULL
              AND lower(r.name) = lower(candidate)
          );
          suffix := suffix + 1;
        END LOOP;
        UPDATE runs SET name = candidate, updated_at = now() WHERE id = dup.id;
      END LOOP;
    END $$;
  `);

  pgm.createIndex('runs', ['project_id', 'lower(name)'], {
    unique: true,
    where: 'deleted_at is null',
    name: 'runs_project_name_unique',
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('runs', ['project_id', 'lower(name)'], {
    name: 'runs_project_name_unique',
  });
};