/**
 * URL-as-state for the plans screen (docs/backlog-slice3-plans-runs.md card 3.3,
 * docs/api-plans.md § GET /projects/:projectId/plans). The URL is the source of
 * truth for the search text, the sort and the page, so a filtered plans view is
 * shareable and back/forward works.
 *
 * There is no status filter: a plan is a container, not a run — its progress is
 * a rollup over its runs (`counts`), not a state of its own.
 */
import type { PlanSort, PlanSortKey } from "./api-types";

/** Columns the table may sort by; their keys match the contract's `sort`. */
export const PLAN_SORT_KEYS: readonly PlanSortKey[] = [
  "name",
  "due_date",
  "created_at",
  "updated_at",
] as const;

export const PLAN_SORTS: readonly PlanSort[] = [
  "created_at",
  "-created_at",
  "updated_at",
  "-updated_at",
  "due_date",
  "-due_date",
  "name",
  "-name",
] as const;

/** Contract default (docs/api-plans.md): newest first. */
export const DEFAULT_PLAN_SORT: PlanSort = "-created_at";

export function isPlanSort(value: string): value is PlanSort {
  return (PLAN_SORTS as readonly string[]).includes(value);
}

export interface PlanListUrlState {
  query: string;
  sort: PlanSort;
  page: number;
}

function readPage(raw: string | null): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

/** Parses and validates every plans-screen query parameter. */
export function parsePlanListParams(params: URLSearchParams): PlanListUrlState {
  const sortRaw = params.get("sort");
  return {
    query: params.get("query") ?? "",
    sort: sortRaw && isPlanSort(sortRaw) ? sortRaw : DEFAULT_PLAN_SORT,
    page: readPage(params.get("page")),
  };
}

export interface PlanListUrlPatch {
  query?: string;
  sort?: PlanSort;
  page?: number;
}

function setOrDelete(
  params: URLSearchParams,
  key: string,
  value: string
): void {
  if (value) params.set(key, value);
  else params.delete(key);
}

/**
 * Applies a patch to the current query string. The default sort and page 1 are
 * dropped so the canonical URL stays short, and changing the search resets to
 * page 1.
 */
export function patchPlanListParams(
  current: URLSearchParams,
  patch: PlanListUrlPatch
): URLSearchParams {
  const params = new URLSearchParams(current.toString());

  if (patch.query !== undefined) setOrDelete(params, "query", patch.query);
  if (patch.sort !== undefined) {
    setOrDelete(
      params,
      "sort",
      patch.sort === DEFAULT_PLAN_SORT ? "" : patch.sort
    );
  }
  if (patch.page !== undefined) {
    setOrDelete(params, "page", patch.page > 1 ? String(patch.page) : "");
  }

  // A new search starts a new result set.
  if (patch.page === undefined && patch.query !== undefined) {
    setOrDelete(params, "page", "");
  }

  // Guarantee the normalised values (invalid input never round-trips).
  return params;
}

/** DataTable sort state → contract sort string. */
export function planSortParam(key: string, dir: "asc" | "desc"): PlanSort {
  if (!(PLAN_SORT_KEYS as readonly string[]).includes(key)) {
    return DEFAULT_PLAN_SORT;
  }
  const value = `${dir === "desc" ? "-" : ""}${key}`;
  return isPlanSort(value) ? value : DEFAULT_PLAN_SORT;
}

/** Contract sort string → DataTable sort state. */
export function planSortState(sort: PlanSort): {
  key: PlanSortKey;
  dir: "asc" | "desc";
} {
  if (sort.startsWith("-")) {
    return { key: sort.slice(1) as PlanSortKey, dir: "desc" };
  }
  return { key: sort as PlanSortKey, dir: "asc" };
}