/**
 * URL-as-state for the reports screen (docs/DESIGN.md §4.9). The URL is the
 * source of truth for the window, the three filters and the progress page.
 *
 * Defaults are omitted from the canonical URL: `days` 30 and `page` 1, the
 * same convention as runs/cases. `none` is a real filter value ("no plan" /
 * "no milestone"), not an absent one, so it is preserved.
 *
 * URL keys are `?plan` and `?milestone` (PRD-reports.md, DESIGN §4.9); the
 * API query is `plan_id`/`milestone_id`, mapped at the request site.
 */
import { RUN_STATUSES, type RunStatus } from "./api-types";
import { TREND_WINDOWS, type TrendWindow } from "./trend-window";

/** Reports defaults to 30 days; the overview's 14 is not reused. */
export const DEFAULT_REPORT_DAYS: TrendWindow = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseReportDays(value: string | null | undefined): TrendWindow {
  const parsed = Number(value);
  return (TREND_WINDOWS as readonly number[]).includes(parsed)
    ? (parsed as TrendWindow)
    : DEFAULT_REPORT_DAYS;
}

function readFilter(raw: string | null): string | null {
  if (!raw) return null;
  return raw === "none" || UUID_RE.test(raw) ? raw : null;
}

function readPage(raw: string | null): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

export interface ReportUrlState {
  project: string | null;
  days: TrendWindow;
  planId: string | null;
  milestoneId: string | null;
  status: RunStatus | null;
  page: number;
}

export function parseReportParams(params: URLSearchParams): ReportUrlState {
  const status = params.get("status");
  return {
    project: params.get("project"),
    days: parseReportDays(params.get("days")),
    planId: readFilter(params.get("plan")),
    milestoneId: readFilter(params.get("milestone")),
    status:
      status && (RUN_STATUSES as readonly string[]).includes(status)
        ? (status as RunStatus)
        : null,
    page: readPage(params.get("page")),
  };
}

export interface ReportUrlPatch {
  project?: string | null;
  days?: TrendWindow;
  planId?: string | null;
  milestoneId?: string | null;
  status?: RunStatus | null;
  page?: number;
}

function setOrDelete(params: URLSearchParams, key: string, value: string): void {
  if (value) params.set(key, value);
  else params.delete(key);
}

/**
 * Applies a patch and keeps the URL canonical. Any window or filter change
 * resets to page 1, because it starts a different result set.
 */
export function patchReportParams(
  current: URLSearchParams,
  patch: ReportUrlPatch
): URLSearchParams {
  const params = new URLSearchParams(current.toString());

  if (patch.project !== undefined) setOrDelete(params, "project", patch.project ?? "");
  if (patch.days !== undefined) {
    setOrDelete(
      params,
      "days",
      patch.days === DEFAULT_REPORT_DAYS ? "" : String(patch.days)
    );
  }
  if (patch.planId !== undefined) setOrDelete(params, "plan", patch.planId ?? "");
  if (patch.milestoneId !== undefined) {
    setOrDelete(params, "milestone", patch.milestoneId ?? "");
  }
  if (patch.status !== undefined) setOrDelete(params, "status", patch.status ?? "");
  if (patch.page !== undefined) {
    setOrDelete(params, "page", patch.page > 1 ? String(patch.page) : "");
  }

  if (
    patch.page === undefined &&
    (patch.days !== undefined ||
      patch.planId !== undefined ||
      patch.milestoneId !== undefined ||
      patch.status !== undefined)
  ) {
    setOrDelete(params, "page", "");
  }

  return params;
}