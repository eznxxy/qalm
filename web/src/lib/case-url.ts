/**
 * URL-as-state for the two-pane cases screen (docs/backlog-slice2-suites-cases.md
 * card 3.2). The URL is the source of truth for the selected suite, the open
 * drawer, filters, sort and page, so views are shareable and back/forward
 * works.
 *
 * Repeatable filters (`priority`, `type`, `tag`) are comma-separated in the
 * URL and become repeated query parameters at the API boundary (the client
 * appends arrays; see docs/api-cases.md).
 */
import type { CaseSort, CaseType, Priority } from "./api-types";
import { CASE_TYPES, PRIORITIES } from "./api-types";

export const CASE_SORTS: readonly CaseSort[] = [
  "case_number",
  "-case_number",
  "updated_at",
  "-updated_at",
  "title",
  "-title",
] as const;

export const DEFAULT_CASE_SORT: CaseSort = "case_number";

export interface CaseListUrlState {
  /** `null` means absent; `"all"` means unscoped. */
  suite: string | null;
  caseId: string | null;
  query: string;
  priorities: Priority[];
  types: CaseType[];
  tags: string[];
  sort: CaseSort;
  page: number;
}

export function isPriority(value: string): value is Priority {
  return (PRIORITIES as readonly string[]).includes(value);
}

export function isCaseType(value: string): value is CaseType {
  return (CASE_TYPES as readonly string[]).includes(value);
}

export function isCaseSort(value: string): value is CaseSort {
  return (CASE_SORTS as readonly string[]).includes(value);
}

function splitList(raw: string | null): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function readPage(raw: string | null): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

/** Parses and validates every cases-screen query parameter. */
export function parseCaseListParams(
  params: URLSearchParams
): CaseListUrlState {
  const sortRaw = params.get("sort");
  return {
    suite: params.get("suite") || null,
    caseId: params.get("case") || null,
    query: params.get("query") ?? "",
    priorities: splitList(params.get("priority")).filter(isPriority),
    types: splitList(params.get("type")).filter(isCaseType),
    // Lowercase before de-duplicating: "Smoke,smoke" is one filter.
    tags: Array.from(
      new Set(splitList(params.get("tag")).map((tag) => tag.toLowerCase()))
    ),
    sort: sortRaw && isCaseSort(sortRaw) ? sortRaw : DEFAULT_CASE_SORT,
    page: readPage(params.get("page")),
  };
}

export interface CaseListUrlPatch {
  suite?: string | null;
  caseId?: string | null;
  query?: string;
  priorities?: readonly Priority[];
  types?: readonly CaseType[];
  tags?: readonly string[];
  sort?: CaseSort;
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
 * Applies a patch to the current query string. Defaults are dropped so the
 * canonical URL stays short (`page=1`, `sort=case_number`, no filters).
 */
export function patchCaseListParams(
  current: URLSearchParams,
  patch: CaseListUrlPatch
): URLSearchParams {
  const params = new URLSearchParams(current.toString());

  if (patch.suite !== undefined) setOrDelete(params, "suite", patch.suite ?? "");
  if (patch.caseId !== undefined) setOrDelete(params, "case", patch.caseId ?? "");
  if (patch.query !== undefined) setOrDelete(params, "query", patch.query);
  if (patch.priorities !== undefined) {
    setOrDelete(params, "priority", patch.priorities.join(","));
  }
  if (patch.types !== undefined) {
    setOrDelete(params, "type", patch.types.join(","));
  }
  if (patch.tags !== undefined) {
    setOrDelete(
      params,
      "tag",
      patch.tags.map((tag) => tag.toLowerCase()).join(",")
    );
  }
  if (patch.sort !== undefined) {
    setOrDelete(
      params,
      "sort",
      patch.sort === DEFAULT_CASE_SORT ? "" : patch.sort
    );
  }
  if (patch.page !== undefined) {
    setOrDelete(params, "page", patch.page > 1 ? String(patch.page) : "");
  }

  // Selecting a suite or changing filters starts a new result set.
  if (
    patch.page === undefined &&
    (patch.suite !== undefined ||
      patch.priorities !== undefined ||
      patch.types !== undefined ||
      patch.tags !== undefined ||
      patch.query !== undefined)
  ) {
    setOrDelete(params, "page", "");
  }

  // Guarantee the normalised values (invalid input never round-trips).
  return params;
}

/** DataTable sort state → contract sort string. */
export function caseSortParam(
  key: string,
  dir: "asc" | "desc"
): CaseSort {
  if (!["case_number", "updated_at", "title"].includes(key)) {
    return DEFAULT_CASE_SORT;
  }
  const base = key as "case_number" | "updated_at" | "title";
  const value = `${dir === "desc" ? "-" : ""}${base}`;
  return isCaseSort(value) ? value : DEFAULT_CASE_SORT;
}

/** Contract sort string → DataTable sort state. */
export function caseSortState(sort: CaseSort): {
  key: "case_number" | "updated_at" | "title";
  dir: "asc" | "desc";
} {
  if (sort.startsWith("-")) {
    return {
      key: sort.slice(1) as "case_number" | "updated_at" | "title",
      dir: "desc",
    };
  }
  return {
    key: sort as "case_number" | "updated_at" | "title",
    dir: "asc",
  };
}
