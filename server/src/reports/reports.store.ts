import { Inject, Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import type { ProjectRef } from '../runs/runs.store';

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
const TREND_SQL = `
WITH days AS (
  SELECT generate_series($2::date, $3::date, interval '1 day')::date AS day
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
     AND res.created_at >= ($2::date::timestamp AT TIME ZONE 'UTC')
     AND res.created_at <  (($3::date + 1)::timestamp AT TIME ZONE 'UTC')
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

  /** Exactly `(to - from) + 1` rows, oldest first, zero-filled. */
  async trend(projectId: string, from: string, to: string): Promise<TrendRow[]> {
    const result = await this.db.query<TrendRow>(TREND_SQL, [projectId, from, to]);
    return result.rows;
  }
}