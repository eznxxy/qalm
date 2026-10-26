import {
  DEFAULT_CASE_SORT,
  caseSortParam,
  caseSortState,
  parseCaseListParams,
  patchCaseListParams,
} from "@/lib/case-url";

/**
 * URL-as-state for the two-pane cases screen (card 3.2). These tests pin the
 * shareable-URL contract: invalid input never round-trips and defaults are
 * dropped so the canonical URL stays short.
 */

function params(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

describe("parseCaseListParams", () => {
  it("defaults everything for an empty query string", () => {
    expect(parseCaseListParams(params(""))).toEqual({
      suite: null,
      caseId: null,
      query: "",
      priorities: [],
      types: [],
      tags: [],
      sort: DEFAULT_CASE_SORT,
      page: 1,
    });
  });

  it("reads the full state", () => {
    const state = parseCaseListParams(
      params("project=p-1&suite=s-2&case=c-3&query=pay&priority=high,low&type=smoke&tag=Payments,smoke&sort=-title&page=3")
    );
    expect(state).toEqual({
      suite: "s-2",
      caseId: "c-3",
      query: "pay",
      priorities: ["high", "low"],
      types: ["smoke"],
      tags: ["payments", "smoke"],
      sort: "-title",
      page: 3,
    });
  });

  it("drops unknown priorities, types, sort and bad pages", () => {
    const state = parseCaseListParams(
      params("priority=urgent,high&type=bogus&sort=bogus&page=0")
    );
    expect(state.priorities).toEqual(["high"]);
    expect(state.types).toEqual([]);
    expect(state.sort).toBe(DEFAULT_CASE_SORT);
    expect(state.page).toBe(1);
  });

  it("accepts priority as a known sort key", () => {
    expect(parseCaseListParams(params("sort=priority")).sort).toBe("priority");
    expect(parseCaseListParams(params("sort=-priority")).sort).toBe(
      "-priority"
    );
  });

  it("keeps `all` distinct from absent", () => {
    expect(parseCaseListParams(params("suite=all")).suite).toBe("all");
    expect(parseCaseListParams(params("")).suite).toBeNull();
  });

  it("de-duplicates repeated values", () => {
    expect(
      parseCaseListParams(params("priority=high,high&tag=Smoke,smoke")).tags
    ).toEqual(["smoke"]);
    expect(parseCaseListParams(params("priority=high,high")).priorities).toEqual([
      "high",
    ]);
  });
});

describe("patchCaseListParams", () => {
  it("writes repeatable filters comma-separated", () => {
    const next = patchCaseListParams(params("project=p-1"), {
      priorities: ["high", "low"],
      types: ["smoke"],
      tags: ["Payments"],
    });
    expect(next.get("priority")).toBe("high,low");
    expect(next.get("type")).toBe("smoke");
    expect(next.get("tag")).toBe("payments");
  });

  it("drops defaults instead of writing them", () => {
    const next = patchCaseListParams(params("sort=-title&page=4"), {
      sort: DEFAULT_CASE_SORT,
      page: 1,
    });
    expect(next.get("sort")).toBeNull();
    expect(next.get("page")).toBeNull();
  });

  it("clears a field when the patch value is empty", () => {
    const next = patchCaseListParams(params("suite=s-1&case=c-1&query=pay"), {
      suite: null,
      caseId: null,
      query: "",
    });
    expect(next.toString()).toBe("");
  });

  it("resets the page when the result set changes", () => {
    const next = patchCaseListParams(params("page=3"), { suite: "s-2" });
    expect(next.get("page")).toBeNull();
    expect(next.get("suite")).toBe("s-2");
  });

  it("keeps an explicit page patch (pagination)", () => {
    const next = patchCaseListParams(params("page=1"), { page: 2 });
    expect(next.get("page")).toBe("2");
  });

  it("preserves unrelated parameters such as project", () => {
    const next = patchCaseListParams(params("project=p-1"), { query: "pay" });
    expect(next.get("project")).toBe("p-1");
  });
});

describe("sort mapping", () => {
  it.each([
    ["case_number", "asc", "case_number"],
    ["case_number", "desc", "-case_number"],
    ["title", "desc", "-title"],
    ["priority", "asc", "priority"],
    ["priority", "desc", "-priority"],
    ["updated_at", "asc", "updated_at"],
  ] as const)("maps %s %s to %s", (key, dir, expected) => {
    expect(caseSortParam(key, dir)).toBe(expected);
  });

  it("falls back to the default for unsortable columns", () => {
    expect(caseSortParam("step_count", "desc")).toBe(DEFAULT_CASE_SORT);
    expect(caseSortParam("tags", "asc")).toBe(DEFAULT_CASE_SORT);
  });

  it("round-trips through DataTable sort state", () => {
    expect(caseSortState("-case_number")).toEqual({
      key: "case_number",
      dir: "desc",
    });
    expect(caseSortState("title")).toEqual({ key: "title", dir: "asc" });
    expect(caseSortState("-priority")).toEqual({
      key: "priority",
      dir: "desc",
    });
    expect(caseSortParam("title", caseSortState("title").dir)).toBe("title");
  });
});
