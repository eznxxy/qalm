import { ItemStatus, ResultStatus } from './runs.constants';
import { StatusCounts, percentComplete } from './run-counts';
import { AttachmentRow, CaseRunRow, ResultRow, RunItemDetailRow, RunItemRow, RunWithCountsRow } from './runs.store';

/** One ordered step of an item's snapshot — api-runs.md § Resource: Run item. */
export interface RunItemStepDto {
  position: number;
  text: string;
  expected_result: string | null;
}

/** The item's newest result; `null` on the item when it has none. */
export interface LatestResultDto {
  id: string;
  status: ResultStatus;
  comment: string | null;
  elapsed_minutes: number | null;
  defect_url: string | null;
  attachment_count: number;
  created_by: string;
  created_at: string;
}

/**
 * API projection of a run — exactly docs/api-runs.md § Resource: Run. List items
 * and the detail share this shape; `status` is derived from `completed_at`.
 */
export interface RunDto {
  id: string;
  project_id: string;
  plan_id: string | null;
  name: string;
  description: string | null;
  status: 'open' | 'completed';
  start_date: string | null;
  due_date: string | null;
  completed_at: string | null;
  completed_by: string | null;
  counts: StatusCounts;
  assignee_ids: string[];
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

/** API projection of a run item — docs/api-runs.md § Resource: Run item. */
export interface RunItemDto {
  id: string;
  run_id: string;
  case_id: string | null;
  case_display_id: string;
  case_title: string;
  case_priority: string;
  case_suite_id: string;
  assignee_id: string | null;
  position: number;
  status: ItemStatus;
  result_count: number;
  latest_result: LatestResultDto | null;
  created_at: string;
  updated_at: string;
}

/**
 * Item detail adds the snapshotted steps and the case's live preconditions
 * (read-through) for the result drawer — `GET /runs/:id/items/:itemId`.
 */
export interface RunItemDetailDto extends RunItemDto {
  case_steps: RunItemStepDto[];
  case_preconditions: string | null;
}

/** Rollup for one run row (all counters arrive as Postgres `count(*)` → string). */
export function countsFromRunRow(row: RunWithCountsRow): StatusCounts {
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

/** `json_agg` yields `null` when a run has no assigned items. */
function toAssigneeIds(value: string[] | null): string[] {
  return value ?? [];
}

export function toRunDto(row: RunWithCountsRow): RunDto {
  return {
    id: row.id,
    project_id: row.project_id,
    plan_id: row.plan_id,
    name: row.name,
    description: row.description,
    status: row.completed_at === null ? 'open' : 'completed',
    start_date: row.start_date,
    due_date: row.due_date,
    completed_at: row.completed_at === null ? null : row.completed_at.toISOString(),
    completed_by: row.completed_by,
    counts: countsFromRunRow(row),
    assignee_ids: toAssigneeIds(row.assignee_ids),
    created_by: row.created_by,
    updated_by: row.updated_by,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function toLatestResultDto(row: RunItemRow): LatestResultDto | null {
  if (row.latest_result_id === null || row.latest_result_created_at === null) return null;
  return {
    id: row.latest_result_id,
    status: row.latest_result_status ?? 'passed',
    comment: row.latest_result_comment,
    elapsed_minutes: row.latest_result_elapsed_minutes,
    defect_url: row.latest_result_defect_url,
    attachment_count: Number(row.latest_result_attachment_count),
    created_by: row.latest_result_created_by ?? '',
    created_at: row.latest_result_created_at.toISOString(),
  };
}

export function toRunItemDto(row: RunItemRow): RunItemDto {
  return {
    id: row.id,
    run_id: row.run_id,
    case_id: row.case_id,
    case_display_id: row.case_display_id,
    case_title: row.case_title,
    case_priority: row.case_priority,
    case_suite_id: row.case_suite_id,
    assignee_id: row.assignee_id,
    position: row.position,
    status: row.status,
    result_count: Number(row.result_count),
    latest_result: toLatestResultDto(row),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

/** The jsonb snapshot is untrusted JSON; normalise it to the documented shape. */
function toSteps(value: unknown): RunItemStepDto[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw): RunItemStepDto => {
    const step = (raw ?? {}) as Record<string, unknown>;
    return {
      position: Number(step['position'] ?? 0),
      text: typeof step['text'] === 'string' ? step['text'] : '',
      expected_result:
        typeof step['expected_result'] === 'string' ? step['expected_result'] : null,
    };
  });
}

export function toRunItemDetailDto(row: RunItemDetailRow): RunItemDetailDto {
  return {
    ...toRunItemDto(row),
    case_steps: toSteps(row.case_steps),
    case_preconditions: row.case_preconditions,
  };
}

/** One attachment of a result — embedded in the Result resource. */
export interface AttachmentDto {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
}

/** API projection of a result — docs/api-runs.md § Resource: Result. */
export interface ResultDto {
  id: string;
  run_item_id: string;
  status: ResultStatus;
  comment: string | null;
  elapsed_minutes: number | null;
  defect_url: string | null;
  attachments: AttachmentDto[];
  created_by: string;
  created_at: string;
}

export function toAttachmentDto(row: AttachmentRow): AttachmentDto {
  return {
    id: row.id,
    filename: row.filename,
    content_type: row.content_type,
    size_bytes: Number(row.size_bytes),
    created_at: row.created_at.toISOString(),
  };
}

/** `attachments` are passed pre-grouped so a list never queries per result. */
export function toResultDto(row: ResultRow, attachments: AttachmentRow[]): ResultDto {
  return {
    id: row.id,
    run_item_id: row.run_item_id,
    status: row.status,
    comment: row.comment,
    elapsed_minutes: row.elapsed_minutes,
    defect_url: row.defect_url,
    attachments: attachments.map(toAttachmentDto),
    created_by: row.created_by,
    created_at: row.created_at.toISOString(),
  };
}

/** One entry of the case's Linked runs feed — docs/api-runs.md § Linked runs. */
export interface CaseRunDto {
  run_id: string;
  run_name: string;
  run_status: 'open' | 'completed';
  plan_id: string | null;
  item_id: string;
  status: ItemStatus;
  updated_at: string;
}

export function toCaseRunDto(row: CaseRunRow): CaseRunDto {
  return {
    run_id: row.run_id,
    run_name: row.run_name,
    run_status: row.run_status,
    plan_id: row.plan_id,
    item_id: row.item_id,
    status: row.status,
    updated_at: row.updated_at.toISOString(),
  };
}