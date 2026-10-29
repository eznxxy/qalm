import { Inject, Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { LATEST_RESULT_JOIN, type ProjectRef } from '../runs/runs.store';
import type { ReportFilter } from './reports.filters';

/**
 * One bucket as the database returns it: zero-filled by `generate_series`, so a
 * day with no results still has a row. `day` is cast to text — the API returns
 * a plain `YYYY-MM-DD`, never a timezone-shifted Date. Every counter is a
 * `count(*)::int`, so pg hands back a number.
 */
export interface TrendRow {
  day: string;
  passed: number;
  failed: number;
  blocked: number;
  retest: number;
  skipped: number;
}

/** One run's current progress plus its activity in the window. */
export interface ProgressRunRow {
  id: string;
  name: string;
  plan_id: string | null;
  plan_name: string | null;
  milestone_id: string | null;
  milestone_name: string | null;
  /** `YYYY-MM-DD` (selected `::text`), never a Date. */
  start_date: string | null;
  due_date: string | null;
  completed: boolean;
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  retest: number;
  skipped: number;
  untested: number;
  results_in_window: number;
  /** `max(created_at)` across all time; `null` when the run has no result. */
  last_result_at: Date | null;
}

/** The `progress.items` rollup over every matching run, not just the page. */
export interface ProgressItemsRow {
  total: number;
  with_results: number;
}

/**
 * Filter clauses shared by every summary statement, docs/api-reports.md
 * § Implementation notes. `$3`/`$5` are the `none` flags; the literal
 * `'none'` never reaches a `::uuid` cast.
 */
const REPORT_FILTER_SQL = `
  AND ($2::uuid IS NULL OR r.plan_id = $2::uuid)
  AND ($3::boolean IS NOT TRUE OR r.plan_id IS NULL)
  AND ($4::uuid IS NULL OR r.milestone_id = $4::uuid)
  AND ($5::boolean IS NOT TRUE OR r.milestone_id IS NULL)
  AND ($6::text IS NULL OR (($6 = 'open') = (r.completed_at IS NULL)))`;

function filterValues(filter: ReportFilter): unknown[] {
  return [
    filter.planId,
    filter.planNone,
    filter.milestoneId,
    filter.milestoneNone,
    filter.status,
  ];
}

/**
 * Every result recorded in the window, bucketed by UTC day, docs/
 * api-project-overview.md § What is counted.
 *
 * - Starts from `results` (the new `results_created_at_idx`), joins the item and
 *   the run by primary key, and requires a live run of this project — a
 *   soft-deleted run's results leave the window.
 * - Counts **every result row**, not the latest per item: a retest is a new
 *   event on the day it happened. This is why it does not reuse
 *   `LATEST_RESULT_JOIN` or the run rollup.
 * - Buckets by `(created_at AT TIME ZONE 'UTC')::date` and restricts with
 *   explicit UTC boundaries. A bare `created_at >= $2::date` would cast the date
 *   in the connection's `TimeZone`, and one pooled session with a non-UTC zone
 *   would shift every boundary by hours.
 */
function trendSql(filterSql: string, fromParam: string, toParam: string): string {
  return `
WITH days AS (
  SELECT generate_series(${fromParam}::date, ${toParam}::date, interval '1 day')::date AS day
), agg AS (
  SELECT (res.created_at AT TIME ZONE 'UTC')::date AS day,
         count(*) FILTER (WHERE res.status = 'passed')::int  AS passed,
         count(*) FILTER (WHERE res.status = 'failed')::int  AS failed,
         count(*) FILTER (WHERE res.status = 'blocked')::int AS blocked,
         count(*) FILTER (WHERE res.status = 'retest')::int  AS retest,
         count(*) FILTER (WHERE res.status = 'skipped')::int AS skipped
    FROM results res
    JOIN run_items i ON i.id = res.run_item_id
    JOIN runs r ON r.id = i.run_id
   WHERE r.project_id = $1
     AND r.deleted_at IS NULL
     ${filterSql}
     AND res.created_at >= (${fromParam}::date::timestamp AT TIME ZONE 'UTC')
     AND res.created_at <  ((${toParam}::date + 1)::timestamp AT TIME ZONE 'UTC')
   GROUP BY 1
)
SELECT d.day::text AS day,
       coalesce(a.passed, 0)::int  AS passed,
       coalesce(a.failed, 0)::int  AS failed,
       coalesce(a.blocked, 0)::int AS blocked,
       coalesce(a.retest, 0)::int  AS retest,
       coalesce(a.skipped, 0)::int AS skipped
  FROM days d
  LEFT JOIN agg a USING (day)
 ORDER BY d.day`;
}

/**
 * Read side of the reports feature. Kept separate from RunsStore: the trend is
 * an event history, not a rollup, and it must not inherit a latest-result join.
 */
@Injectable()
export class ReportsStore {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  /** Project visibility lookup; the archived rule lives in the service. */
  async findProject(projectId: string): Promise<ProjectRef | null> {
    const result = await this.db.query<ProjectRef>(
      'SELECT id, status FROM projects WHERE id = $1',
      [projectId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Exactly `(to - from) + 1` rows, oldest first, zero-filled. With
   * `filter = null` the statement is the unfiltered overview trend, byte for
   * byte; the summary passes a filter and shifts the window to `$7`/`$8`.
   */
  async trend(
    projectId: string,
    from: string,
    to: string,
    filter: ReportFilter | null = null,
  ): Promise<TrendRow[]> {
    const sql = filter
      ? trendSql(REPORT_FILTER_SQL, '$7', '$8')
      : trendSql('', '$2', '$3');
    const values = filter
      ? [projectId, ...filterValues(filter), from, to]
      : [projectId, from, to];
    const result = await this.db.query<TrendRow>(sql, values);
    return result.rows;
  }

  /** How many live runs match the filters — the `meta.total` for the page. */
  async countRuns(projectId: string, filter: ReportFilter): Promise<number> {
    const result = await this.db.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM runs r
        WHERE r.project_id = $1
          AND r.deleted_at IS NULL
          ${REPORT_FILTER_SQL}`,
      [projectId, ...filterValues(filter)],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  /**
   * The current progress of one page of runs. Counts each item once by its
   * latest result (`LATEST_RESULT_JOIN`), while `results_in_window` counts
   * events and `last_result_at` deliberately ignores the window.
   */
  async progress(
    projectId: string,
    filter: ReportFilter,
    from: string,
    to: string,
    limit: number,
    offset: number,
  ): Promise<ProgressRunRow[]> {
    const result = await this.db.query<ProgressRunRow>(
      `SELECT r.id, r.name,
              r.plan_id, p.name AS plan_name,
              r.milestone_id, m.name AS milestone_name,
              r.start_date::text AS start_date,
              r.due_date::text AS due_date,
              (r.completed_at IS NOT NULL) AS completed,
              count(i.id)::int AS total,
              count(*) FILTER (WHERE lr.status = 'passed')::int  AS passed,
              count(*) FILTER (WHERE lr.status = 'failed')::int  AS failed,
              count(*) FILTER (WHERE lr.status = 'blocked')::int AS blocked,
              count(*) FILTER (WHERE lr.status = 'retest')::int  AS retest,
              count(*) FILTER (WHERE lr.status = 'skipped')::int AS skipped,
              count(*) FILTER (WHERE i.id IS NOT NULL AND lr.id IS NULL)::int AS untested,
              (SELECT count(*)::int
                 FROM results res
                 JOIN run_items ri ON ri.id = res.run_item_id
                WHERE ri.run_id = r.id
                  AND res.created_at >= ($7::date::timestamp AT TIME ZONE 'UTC')
                  AND res.created_at <  (($8::date + 1)::timestamp AT TIME ZONE 'UTC'))
                AS results_in_window,
              (SELECT max(res.created_at)
                 FROM results res
                 JOIN run_items ri ON ri.id = res.run_item_id
                WHERE ri.run_id = r.id) AS last_result_at
         FROM runs r
         LEFT JOIN plans p ON p.id = r.plan_id
         LEFT JOIN milestones m ON m.id = r.milestone_id
                               AND m.deleted_at IS NULL
         LEFT JOIN run_items i ON i.run_id = r.id
         ${LATEST_RESULT_JOIN}
        WHERE r.project_id = $1
          AND r.deleted_at IS NULL
          ${REPORT_FILTER_SQL}
        GROUP BY r.id, p.name, m.name
        ORDER BY (r.completed_at IS NOT NULL), r.due_date ASC NULLS LAST,
                 lower(r.name), r.id
        LIMIT $9 OFFSET $10`,
      [projectId, ...filterValues(filter), from, to, limit, offset],
    );
    return result.rows;
  }

  /** The `progress.items` rollup over every matching run, not just the page. */
  async progressItems(
    projectId: string,
    filter: ReportFilter,
  ): Promise<ProgressItemsRow> {
    const result = await this.db.query<ProgressItemsRow>(
      `SELECT count(i.id)::int AS total,
              count(i.id) FILTER (WHERE lr.id IS NOT NULL)::int AS with_results
         FROM runs r
         LEFT JOIN run_items i ON i.run_id = r.id
         ${LATEST_RESULT_JOIN}
        WHERE r.project_id = $1
          AND r.deleted_at IS NULL
          ${REPORT_FILTER_SQL}`,
      [projectId, ...filterValues(filter)],
    );
    return result.rows[0] ?? { total: 0, with_results: 0 };
  }
}