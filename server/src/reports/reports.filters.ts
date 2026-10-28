import type { ReportSummaryQuery } from './reports.dto';

export type ReportStatus = 'open' | 'completed';

/**
 * Filters after the `none` sentinel is resolved, docs/api-reports.md
 * § Implementation notes. The store never casts `'none'` to uuid.
 */
export interface ReportFilter {
  planId: string | null;
  planNone: boolean;
  milestoneId: string | null;
  milestoneNone: boolean;
  status: ReportStatus | null;
}

export function resolveReportFilters(query: ReportSummaryQuery): ReportFilter {
  const plan = query.plan_id;
  const milestone = query.milestone_id;
  return {
    planId: plan && plan !== 'none' ? plan : null,
    planNone: plan === 'none',
    milestoneId: milestone && milestone !== 'none' ? milestone : null,
    milestoneNone: milestone === 'none',
    status: query.status ?? null,
  };
}

/** The `filters` echo: raw values, so `none` survives for the client. */
export interface ReportFiltersDto {
  plan_id: string | null;
  milestone_id: string | null;
  status: ReportStatus | null;
}

export function toReportFiltersDto(query: ReportSummaryQuery): ReportFiltersDto {
  return {
    plan_id: query.plan_id ?? null,
    milestone_id: query.milestone_id ?? null,
    status: query.status ?? null,
  };
}