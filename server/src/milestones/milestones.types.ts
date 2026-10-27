import { StatusCounts, percentComplete } from '../runs/run-counts';
import { MilestoneAggRow } from './milestones.store';

/** API projection of a milestone — exactly docs/api-milestones.md § Resource. */
export interface MilestoneDto {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  due_date: string | null;
  status: 'open' | 'completed';
  run_count: number;
  counts: StatusCounts;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

/** Percentages are re-derived from the summed totals, never averaged. */
export function countsFromMilestoneRow(row: MilestoneAggRow): StatusCounts {
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

export function toMilestoneDto(row: MilestoneAggRow): MilestoneDto {
  return {
    id: row.id,
    project_id: row.project_id,
    name: row.name,
    description: row.description,
    due_date: row.due_date,
    status: row.status,
    run_count: Number(row.run_count),
    counts: countsFromMilestoneRow(row),
    created_by: row.created_by,
    updated_by: row.updated_by,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}