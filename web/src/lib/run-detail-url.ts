/**
 * URL-as-state for the run detail screen (docs/backlog-slice3-plans-runs.md card
 * 3.2, docs/DESIGN.md §4.4). The URL is the source of truth for the open result
 * drawer (`item`), the item filters (status / assignee / section / search), the
 * sort and the page, so a filtered run view is shareable and back/forward works.
 *
 * Repeatable item statuses are comma-separated in the URL (the same convention
 * the cases screen uses for `priority`/`type`/`tag`) and become repeated query
 * parameters at the API boundary (docs/api-runs.md § GET /runs/:id/items).
 */
import type { ItemStatus, RunItemSort, RunItemSortKey } from "./api-types";
import { ITEM_STATUSES } from "./api-types";

/** Columns the items table may sort by; their keys match the contract's sort. */
export const RUN_ITEM_SORT_KEYS: readonly RunItemSortKey[] = [
  "position",
  "case_display_id",
  "status",
  "updated_at",
] as const;

export const RUN_ITEM_SORTS: readonly RunItemSort[] = [
  "position",
  "-position",
  "case_display_id",
  "-case_display_id",
  "status",
  "-status",
  "updated_at",
  "-updated_at",
] as const;

/** Contract default (docs/api-runs.md): the run's authored order, ascending. */
export const DEFAULT_RUN_ITEM_SORT: RunItemSort = "position";

/** The `assignee_id=none` sentinel — items with no assignee. */
export const UNASSIGNED = "none";

export function isItemStatusFilter(value: string): value is ItemStatus {
  return (ITEM_STATUSES as readonly string[]).includes(value);
}

export function isRunItemSort(value: string): value is RunItemSort {
  return (RUN_ITEM_SORTS as readonly string[]).includes(value);
}

export interface RunDetailUrlState {
  /** The open result drawer's item id, or null when closed. */
  item: string | null;
  statuses: ItemStatus[];
  /** A user id, the literal `"none"`, or null for "anyone". */
  assignee: string | null;
  suite: string | null;
  query: string;
  sort: RunItemSort;
  page: number;
}

function splitList(raw: string | null): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}

function readPage(raw: string | null): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

/** Parses and validates every run-detail query parameter. */
export function parseRunDetailParams(
  params: URLSearchParams
): RunDetailUrlState {
  const sortRaw = params.get("sort");
  return {
    item: params.get("item") || null,
    statuses: splitList(params.get("status")).filter(isItemStatusFilter),
    assignee: params.get("assignee") || null,
    suite: params.get("suite") || null,
    query: params.get("query") ?? "",
    sort: sortRaw && isRunItemSort(sortRaw) ? sortRaw : DEFAULT_RUN_ITEM_SORT,
    page: readPage(params.get("page")),
  };
}

export interface RunDetailUrlPatch {
  item?: string | null;
  statuses?: readonly ItemStatus[];
  assignee?: string | null;
  suite?: string | null;
  query?: string;
  sort?: RunItemSort;
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
 * Applies a patch to the current query string. Defaults (position sort, page 1)
 * are dropped so the canonical URL stays short, and changing any filter resets
 * to page 1. Opening/closing the drawer (`item`) never touches the page.
 */
export function patchRunDetailParams(
  current: URLSearchParams,
  patch: RunDetailUrlPatch
): URLSearchParams {
  const params = new URLSearchParams(current.toString());

  if (patch.item !== undefined) setOrDelete(params, "item", patch.item ?? "");
  if (patch.statuses !== undefined) {
    setOrDelete(params, "status", patch.statuses.join(","));
  }
  if (patch.assignee !== undefined) {
    setOrDelete(params, "assignee", patch.assignee ?? "");
  }
  if (patch.suite !== undefined) setOrDelete(params, "suite", patch.suite ?? "");
  if (patch.query !== undefined) setOrDelete(params, "query", patch.query);
  if (patch.sort !== undefined) {
    setOrDelete(
      params,
      "sort",
      patch.sort === DEFAULT_RUN_ITEM_SORT ? "" : patch.sort
    );
  }
  if (patch.page !== undefined) {
    setOrDelete(params, "page", patch.page > 1 ? String(patch.page) : "");
  }

  // A new filter or search starts a new result set.
  if (
    patch.page === undefined &&
    (patch.statuses !== undefined ||
      patch.assignee !== undefined ||
      patch.suite !== undefined ||
      patch.query !== undefined)
  ) {
    setOrDelete(params, "page", "");
  }

  return params;
}

/** DataTable sort state → contract sort string. */
export function runItemSortParam(key: string, dir: "asc" | "desc"): RunItemSort {
  if (!(RUN_ITEM_SORT_KEYS as readonly string[]).includes(key)) {
    return DEFAULT_RUN_ITEM_SORT;
  }
  const value = `${dir === "desc" ? "-" : ""}${key}`;
  return isRunItemSort(value) ? value : DEFAULT_RUN_ITEM_SORT;
}

/** Contract sort string → DataTable sort state. */
export function runItemSortState(sort: RunItemSort): {
  key: RunItemSortKey;
  dir: "asc" | "desc";
} {
  if (sort.startsWith("-")) {
    return { key: sort.slice(1) as RunItemSortKey, dir: "desc" };
  }
  return { key: sort as RunItemSortKey, dir: "asc" };
}