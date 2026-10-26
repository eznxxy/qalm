import {
  DEFAULT_RUN_SORT,
  DEFAULT_RUN_STATUS,
  isRunSort,
  isRunStatus,
  parseRunListParams,
  patchRunListParams,
  runSortParam,
  runSortState,
} from "@/lib/run-url";

/**
 * URL-as-state for the runs list (backlog card 3.1). These tests pin the
 * shareable-URL contract: invalid input never round-trips, and the product
 * defaults (Open status, newest-first sort, page 1) are dropped so the
 * canonical URL stays short.
 */

function params(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

describe("parseRunListParams", () => {
  it("defaults to open + newest first for an empty query string", () => {
    expect(parseRunListParams(params(""))).toEqual({
      query: "",
      status: DEFAULT_RUN_STATUS,
      sort: DEFAULT_RUN_SORT,
      page: 1,
    });
    expect(DEFAULT_RUN_STATUS).toBe("open");
    expect(DEFAULT_RUN_SORT).toBe("-created_at");
  });

  it("reads the full state", () => {
    const state = parseRunListParams(
      params("project=p-1&query=release&status=completed&sort=due_date&page=3")
    );
    expect(state).toEqual({
      query: "release",
      status: "completed",
      sort: "due_date",
      page: 3,
    });
  });

  it("drops an unknown status, sort and bad pages", () => {
    const state = parseRunListParams(
      params("status=bogus&sort=bogus&page=0")
    );
    expect(state.status).toBe(DEFAULT_RUN_STATUS);
    expect(state.sort).toBe(DEFAULT_RUN_SORT);
    expect(state.page).toBe(1);
  });

  it("accepts open explicitly", () => {
    expect(parseRunListParams(params("status=open")).status).toBe("open");
  });

  it("rejects a non-integer or negative page", () => {
    expect(parseRunListParams(params("page=2.5")).page).toBe(1);
    expect(parseRunListParams(params("page=-4")).page).toBe(1);
  });
});

describe("patchRunListParams", () => {
  it("drops the default status and sort instead of writing them", () => {
    const next = patchRunListParams(params("status=completed&sort=name&page=4"), {
      status: DEFAULT_RUN_STATUS,
      sort: DEFAULT_RUN_SORT,
      page: 1,
    });
    expect(next.get("status")).toBeNull();
    expect(next.get("sort")).toBeNull();
    expect(next.get("page")).toBeNull();
  });

  it("writes a non-default status and sort", () => {
    const next = patchRunListParams(params(""), {
      status: "completed",
      sort: "due_date",
    });
    expect(next.get("status")).toBe("completed");
    expect(next.get("sort")).toBe("due_date");
  });

  it("clears the search when the patch value is empty", () => {
    const next = patchRunListParams(params("query=release"), { query: "" });
    expect(next.get("query")).toBeNull();
  });

  it("resets the page when the search or filter changes", () => {
    expect(
      patchRunListParams(params("page=3"), { query: "pay" }).get("page")
    ).toBeNull();
    expect(
      patchRunListParams(params("page=3"), { status: "completed" }).get("page")
    ).toBeNull();
  });

  it("keeps an explicit page patch (pagination)", () => {
    const next = patchRunListParams(params("page=1"), { page: 2 });
    expect(next.get("page")).toBe("2");
  });

  it("preserves unrelated parameters such as project", () => {
    const next = patchRunListParams(params("project=p-1"), { query: "pay" });
    expect(next.get("project")).toBe("p-1");
  });
});

describe("sort mapping", () => {
  it.each([
    ["name", "asc", "name"],
    ["name", "desc", "-name"],
    ["due_date", "asc", "due_date"],
    ["due_date", "desc", "-due_date"],
    ["created_at", "asc", "created_at"],
    ["updated_at", "desc", "-updated_at"],
  ] as const)("maps %s %s to %s", (key, dir, expected) => {
    expect(runSortParam(key, dir)).toBe(expected);
  });

  it("falls back to the default for unsortable columns", () => {
    expect(runSortParam("status_bar", "desc")).toBe(DEFAULT_RUN_SORT);
    expect(runSortParam("percent_complete", "asc")).toBe(DEFAULT_RUN_SORT);
    expect(runSortParam("assignees", "asc")).toBe(DEFAULT_RUN_SORT);
  });

  it("round-trips through DataTable sort state", () => {
    expect(runSortState("-due_date")).toEqual({ key: "due_date", dir: "desc" });
    expect(runSortState("name")).toEqual({ key: "name", dir: "asc" });
    expect(runSortParam("name", runSortState("name").dir)).toBe("name");
    expect(runSortParam("due_date", runSortState("-due_date").dir)).toBe(
      "-due_date"
    );
  });
});

describe("guards", () => {
  it("narrows known statuses and sorts only", () => {
    expect(isRunStatus("open")).toBe(true);
    expect(isRunStatus("completed")).toBe(true);
    expect(isRunStatus("archived")).toBe(false);
    expect(isRunSort("-created_at")).toBe(true);
    expect(isRunSort("created")).toBe(false);
  });
});