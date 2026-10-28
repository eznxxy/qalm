/**
 * URL-as-state for the milestones list (docs/backlog-slice4-milestones.md card
 * 3.1). The URL is the source of truth for the search text, the Open/Completed
 * filter, sort and page so views are shareable and back/forward works.
 *
 * Unlike the runs list, the milestone screen's product default is **All** — the
 * list answers "what is coming up" as well as "what is done" — so no `status`
 * means no filter and the canonical URL simply omits it. The API default sort is
 * `due_date` with undated milestones last (docs/api-milestones.md).
 */
import type {
  MilestoneSort,
  MilestoneSortKey,
  MilestoneStatus,
} from "./api-types";
import { MILESTONE_STATUSES } from "./api-types";

/** Columns the table may sort by; their keys match the contract's `sort`. */
export const MILESTONE_SORT_KEYS: readonly MilestoneSortKey[] = [
  "name",
  "due_date",
  "created_at",
  "updated_at",
] as const;

export const MILESTONE_SORTS: readonly MilestoneSort[] = [
  "due_date",
  "-due_date",
  "created_at",
  "-created_at",
  "updated_at",
  "-updated_at",
  "name",
  "-name",
] as const;

/** Contract default: soonest due date first, undated last. */
export const DEFAULT_MILESTONE_SORT: MilestoneSort = "due_date";

export function isMilestoneStatus(value: string): value is MilestoneStatus {
  return (MILESTONE_STATUSES as readonly string[]).includes(value);
}

export function isMilestoneSort(value: string): value is MilestoneSort {
  return (MILESTONE_SORTS as readonly string[]).includes(value);
}

export interface MilestoneListUrlState {
  query: string;
  /** `null` = All (the default). */
  status: MilestoneStatus | null;
  sort: MilestoneSort;
  page: number;
}

function readPage(raw: string | null): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

/** Parses and validates every milestones-screen query parameter. */
export function parseMilestoneListParams(
  params: URLSearchParams
): MilestoneListUrlState {
  const statusRaw = params.get("status");
  const sortRaw = params.get("sort");
  return {
    query: params.get("query") ?? "",
    status:
      statusRaw && isMilestoneStatus(statusRaw) ? statusRaw : null,
    sort:
      sortRaw && isMilestoneSort(sortRaw)
        ? sortRaw
        : DEFAULT_MILESTONE_SORT,
    page: readPage(params.get("page")),
  };
}

export interface MilestoneListUrlPatch {
  query?: string;
  status?: MilestoneStatus | null;
  sort?: MilestoneSort;
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
 * Applies a patch to the current query string. Defaults (All status, default
 * sort, page 1) are dropped so the canonical URL stays short, and changing the
 * search or filter resets to page 1.
 */
export function patchMilestoneListParams(
  current: URLSearchParams,
  patch: MilestoneListUrlPatch
): URLSearchParams {
  const params = new URLSearchParams(current.toString());

  if (patch.query !== undefined) setOrDelete(params, "query", patch.query);
  if (patch.status !== undefined) setOrDelete(params, "status", patch.status ?? "");
  if (patch.sort !== undefined) {
    setOrDelete(
      params,
      "sort",
      patch.sort === DEFAULT_MILESTONE_SORT ? "" : patch.sort
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

  return params;
}

/** DataTable sort state → contract sort string. */
export function milestoneSortParam(
  key: string,
  dir: "asc" | "desc"
): MilestoneSort {
  if (!(MILESTONE_SORT_KEYS as readonly string[]).includes(key)) {
    return DEFAULT_MILESTONE_SORT;
  }
  const value = `${dir === "desc" ? "-" : ""}${key}`;
  return isMilestoneSort(value) ? value : DEFAULT_MILESTONE_SORT;
}

/** Contract sort string → DataTable sort state. */
export function milestoneSortState(sort: MilestoneSort): {
  key: MilestoneSortKey;
  dir: "asc" | "desc";
} {
  if (sort.startsWith("-")) {
    return { key: sort.slice(1) as MilestoneSortKey, dir: "desc" };
  }
  return { key: sort as MilestoneSortKey, dir: "asc" };
}