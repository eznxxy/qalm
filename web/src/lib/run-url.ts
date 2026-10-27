/**
 * URL-as-state for the runs list screen (docs/backlog-slice3-plans-runs.md card
 * 3.1). The URL is the source of truth for the search text, the Open/Completed
 * filter, sort and page so views are shareable and back/forward works.
 *
 * The screen always sends an explicit `status` to the API (the product default
 * is Open), but the canonical URL omits it while it is the default — the same
 * convention the cases screen uses to drop `sort=case_number`.
 */
import type { RunSort, RunSortKey, RunStatus } from "./api-types";
import { RUN_STATUSES } from "./api-types";

/** Columns the table may sort by; their keys match the contract's `sort`. */
export const RUN_SORT_KEYS: readonly RunSortKey[] = [
  "name",
  "start_date",
  "due_date",
  "created_at",
  "updated_at",
] as const;

export const RUN_SORTS: readonly RunSort[] = [
  "created_at",
  "-created_at",
  "updated_at",
  "-updated_at",
  "start_date",
  "-start_date",
  "due_date",
  "-due_date",
  "name",
  "-name",
] as const;

/** Contract default (docs/api-runs.md): newest first. */
export const DEFAULT_RUN_SORT: RunSort = "-created_at";

/** Product default for the runs list: show the work that is still open. */
export const DEFAULT_RUN_STATUS: RunStatus = "open";

export function isRunStatus(value: string): value is RunStatus {
  return (RUN_STATUSES as readonly string[]).includes(value);
}

export function isRunSort(value: string): value is RunSort {
  return (RUN_SORTS as readonly string[]).includes(value);
}

export interface RunListUrlState {
  query: string;
  status: RunStatus;
  sort: RunSort;
  page: number;
}

function readPage(raw: string | null): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

/** Parses and validates every runs-screen query parameter. */
export function parseRunListParams(params: URLSearchParams): RunListUrlState {
  const statusRaw = params.get("status");
  const sortRaw = params.get("sort");
  return {
    query: params.get("query") ?? "",
    status:
      statusRaw && isRunStatus(statusRaw) ? statusRaw : DEFAULT_RUN_STATUS,
    sort: sortRaw && isRunSort(sortRaw) ? sortRaw : DEFAULT_RUN_SORT,
    page: readPage(params.get("page")),
  };
}

export interface RunListUrlPatch {
  query?: string;
  status?: RunStatus;
  sort?: RunSort;
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
 * Applies a patch to the current query string. Defaults (Open status, default
 * sort, page 1) are dropped so the canonical URL stays short, and changing the
 * search or filter resets to page 1.
 */
export function patchRunListParams(
  current: URLSearchParams,
  patch: RunListUrlPatch
): URLSearchParams {
  const params = new URLSearchParams(current.toString());

  if (patch.query !== undefined) setOrDelete(params, "query", patch.query);
  if (patch.status !== undefined) {
    setOrDelete(
      params,
      "status",
      patch.status === DEFAULT_RUN_STATUS ? "" : patch.status
    );
  }
  if (patch.sort !== undefined) {
    setOrDelete(
      params,
      "sort",
      patch.sort === DEFAULT_RUN_SORT ? "" : patch.sort
    );
  }
  if (patch.page !== undefined) {
    setOrDelete(params, "page", patch.page > 1 ? String(patch.page) : "");
  }

  // A new search or filter starts a new result set.
  if (
    patch.page === undefined &&
    (patch.status !== undefined || patch.query !== undefined)
  ) {
    setOrDelete(params, "page", "");
  }

  // Guarantee the normalised values (invalid input never round-trips).
  return params;
}

/** DataTable sort state → contract sort string. */
export function runSortParam(key: string, dir: "asc" | "desc"): RunSort {
  if (!(RUN_SORT_KEYS as readonly string[]).includes(key)) {
    return DEFAULT_RUN_SORT;
  }
  const value = `${dir === "desc" ? "-" : ""}${key}`;
  return isRunSort(value) ? value : DEFAULT_RUN_SORT;
}

/** Contract sort string → DataTable sort state. */
export function runSortState(sort: RunSort): {
  key: RunSortKey;
  dir: "asc" | "desc";
} {
  if (sort.startsWith("-")) {
    return { key: sort.slice(1) as RunSortKey, dir: "desc" };
  }
  return { key: sort as RunSortKey, dir: "asc" };
}