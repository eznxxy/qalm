import {
  DEFAULT_PLAN_SORT,
  parsePlanListParams,
  patchPlanListParams,
  planSortParam,
  planSortState,
  PLAN_SORT_KEYS,
} from "@/lib/plan-url";

/**
 * URL-as-state for the plans screen (backlog card 3.3). These tests pin the
 * shareable-URL contract: invalid input never round-trips, and the defaults
 * (newest-first sort, page 1) are dropped so the canonical URL stays short.
 */

function params(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

describe("parsePlanListParams", () => {
  it("defaults to newest first for an empty query string", () => {
    expect(parsePlanListParams(params(""))).toEqual({
      query: "",
      sort: DEFAULT_PLAN_SORT,
      page: 1,
    });
    expect(DEFAULT_PLAN_SORT).toBe("-created_at");
  });

  it("reads the full state", () => {
    expect(
      parsePlanListParams(params("query=release&sort=due_date&page=3"))
    ).toEqual({ query: "release", sort: "due_date", page: 3 });
  });

  it("drops an unknown sort and a bad page", () => {
    const state = parsePlanListParams(params("sort=priority&page=0"));
    expect(state.sort).toBe(DEFAULT_PLAN_SORT);
    expect(state.page).toBe(1);
  });

  it("accepts every documented sort", () => {
    for (const sort of ["created_at", "-updated_at", "name", "-due_date"]) {
      expect(parsePlanListParams(params(`sort=${sort}`)).sort).toBe(sort);
    }
  });
});

describe("patchPlanListParams", () => {
  it("drops the default sort and page 1", () => {
    const next = patchPlanListParams(params("sort=name&page=4"), {
      sort: DEFAULT_PLAN_SORT,
      page: 1,
    });
    expect(next.get("sort")).toBeNull();
    expect(next.get("page")).toBeNull();
  });

  it("writes a non-default sort", () => {
    expect(
      patchPlanListParams(params(""), { sort: "-due_date" }).get("sort")
    ).toBe("-due_date");
  });

  it("resets the page when the search changes", () => {
    expect(
      patchPlanListParams(params("page=3"), { query: "release" }).get("page")
    ).toBeNull();
  });

  it("keeps an explicit page patch (pagination)", () => {
    expect(patchPlanListParams(params(""), { page: 2 }).get("page")).toBe("2");
  });

  it("clears the search when the value is empty", () => {
    expect(
      patchPlanListParams(params("query=release"), { query: "" }).get("query")
    ).toBeNull();
  });

  it("preserves unrelated parameters such as project", () => {
    const next = patchPlanListParams(params("project=p-1"), { query: "a" });
    expect(next.get("project")).toBe("p-1");
  });
});

describe("sort mapping", () => {
  it.each([
    ["name", "asc", "name"],
    ["name", "desc", "-name"],
    ["due_date", "asc", "due_date"],
    ["due_date", "desc", "-due_date"],
  ] as const)("maps %s %s to %s", (key, dir, expected) => {
    expect(planSortParam(key, dir)).toBe(expected);
  });

  it("falls back to the default for unsortable columns", () => {
    expect(planSortParam("run_count", "desc")).toBe(DEFAULT_PLAN_SORT);
    expect(planSortParam("status_bar", "asc")).toBe(DEFAULT_PLAN_SORT);
  });

  it("round-trips through DataTable sort state", () => {
    expect(planSortState("-due_date")).toEqual({ key: "due_date", dir: "desc" });
    expect(planSortState("name")).toEqual({ key: "name", dir: "asc" });
  });

  it("guards known sorts only", () => {
    expect(PLAN_SORT_KEYS).toContain("due_date");
    expect(
      PLAN_SORT_KEYS.some((key) => key === ("run_count" as never))
    ).toBe(false);
  });
});