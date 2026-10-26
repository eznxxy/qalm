import { StatusCounts, emptyCounts, percentComplete } from '../runs/run-counts';
import { PlanAggRow, PlanRow } from './plans.store';

/** API projection of a plan — exactly docs/api-plans.md § Resource: Plan. */
export interface PlanDto {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  due_date: string | null;
  run_count: number;
  counts: StatusCounts;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

/** Percentages are re-derived from the summed totals, never averaged. */
export function countsFromPlanRow(row: PlanAggRow): StatusCounts {
  const total = Number(row.total);
  const untested = Number(row.untested);
  return {
    total,
    passed: Number(row.passed),
    failed: Number(row.failed),
    blocked: Number(row.blocked),
    retest: Number(row.retest),
    skipped: Number(row.skipped),
    untested,
    percent_complete: percentComplete(total, untested),
  };
}

export function toPlanDto(row: PlanAggRow): PlanDto {
  return {
    id: row.id,
    project_id: row.project_id,
    name: row.name,
    description: row.description,
    due_date: row.due_date,
    run_count: Number(row.run_count),
    counts: countsFromPlanRow(row),
    created_by: row.created_by,
    updated_by: row.updated_by,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

/** A freshly created (or just-fetched bare) plan has no runs and no counts. */
export function barePlanDto(row: PlanRow): PlanDto {
  return {
    id: row.id,
    project_id: row.project_id,
    name: row.name,
    description: row.description,
    due_date: row.due_date,
    run_count: 0,
    counts: emptyCounts(),
    created_by: row.created_by,
    updated_by: row.updated_by,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}