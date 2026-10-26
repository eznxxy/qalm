import { CaseAction, CasePriority, CaseType } from './cases.constants';
import { CaseHistoryRow, CaseListRow, CaseRow, CaseStepRow } from './cases.store';

/** One ordered step — docs/api-cases.md § Resource (detail). */
export interface CaseStepDto {
  position: number;
  text: string;
  expected_result: string | null;
}

/** API projection of a case — exactly docs/api-cases.md § Resource (detail). */
export interface CaseDto {
  id: string;
  project_id: string;
  suite_id: string | null;
  case_number: number;
  display_id: string;
  title: string;
  preconditions: string | null;
  steps: CaseStepDto[];
  priority: CasePriority;
  type: CaseType;
  tags: string[];
  estimate_minutes: number | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

/**
 * List items omit the step bodies and preconditions and carry `step_count`
 * instead (docs/api-cases.md § Resource (list item)).
 */
export type CaseListDto = Omit<CaseDto, 'steps' | 'preconditions'> & { step_count: number };

/** A history diff entry: the old value and the new one. */
export interface CaseChange {
  from: unknown;
  to: unknown;
}

export interface CaseHistoryDto {
  id: string;
  case_id: string;
  actor_id: string;
  action: CaseAction;
  changes: Record<string, CaseChange>;
  created_at: string;
}

/** Human-readable, project-scoped case id — `C1042`. */
export function toDisplayId(caseNumber: number): string {
  return `C${caseNumber}`;
}

export function toCaseStepDto(row: CaseStepRow): CaseStepDto {
  return { position: row.position, text: row.text, expected_result: row.expected_result };
}

export function toCaseDto(row: CaseRow, steps: CaseStepRow[]): CaseDto {
  return {
    id: row.id,
    project_id: row.project_id,
    suite_id: row.suite_id,
    case_number: row.case_number,
    display_id: toDisplayId(row.case_number),
    title: row.title,
    preconditions: row.preconditions,
    steps: steps.map(toCaseStepDto),
    priority: row.priority,
    type: row.type,
    tags: row.tags,
    estimate_minutes: row.estimate_minutes,
    created_by: row.created_by,
    updated_by: row.updated_by,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export function toCaseListDto(row: CaseListRow): CaseListDto {
  return {
    id: row.id,
    project_id: row.project_id,
    suite_id: row.suite_id,
    case_number: row.case_number,
    display_id: toDisplayId(row.case_number),
    title: row.title,
    priority: row.priority,
    type: row.type,
    tags: row.tags,
    estimate_minutes: row.estimate_minutes,
    step_count: Number(row.step_count),
    created_by: row.created_by,
    updated_by: row.updated_by,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export function toCaseHistoryDto(row: CaseHistoryRow): CaseHistoryDto {
  return {
    id: row.id,
    case_id: row.case_id,
    actor_id: row.actor_id,
    action: row.action,
    changes: row.changes as Record<string, CaseChange>,
    created_at: row.created_at.toISOString(),
  };
}
