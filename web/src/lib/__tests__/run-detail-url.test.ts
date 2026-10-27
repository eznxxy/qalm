import {
  DEFAULT_RUN_ITEM_SORT,
  UNASSIGNED,
  isRunItemSort,
  parseRunDetailParams,
  patchRunDetailParams,
  runItemSortParam,
  runItemSortState,
} from "@/lib/run-detail-url";

/**
 * URL-as-state for the run detail screen (backlog card 3.2). These tests pin the
 * shareable-URL contract: the drawer param, the item filters, the sort and the
 * page. Defaults are dropped; a filter change resets the page but opening the
 * drawer never does (so back/forward through items keeps the row in view).
 */

function params(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

describe("parseRunDetailParams", () => {
  it("defaults to an empty view for a bare URL", () => {
    expect(parseRunDetailParams(params(""))).toEqual({
      item: null,
      statuses: [],
      assignee: null,
      suite: null,
      query: "",
      sort: DEFAULT_RUN_ITEM_SORT,
      page: 1,
    });
    expect(DEFAULT_RUN_ITEM_SORT).toBe("position");
  });

  it("reads the full state", () => {
    expect(
      parseRunDetailParams(
        params(
          "item=i-1&status=failed,untested&assignee=u-9&suite=s-1&query=card&sort=-status&page=3"
        )
      )
    ).toEqual({
      item: "i-1",
      statuses: ["failed", "untested"],
      assignee: "u-9",
      suite: "s-1",
      query: "card",
      sort: "-status",
      page: 3,
    });
  });

  it("keeps the unassigned sentinel as a plain value", () => {
    expect(parseRunDetailParams(params("assignee=none")).assignee).toBe(
      UNASSIGNED
    );
  });

  it("drops unknown statuses, an unknown sort and bad pages", () => {
    const state = parseRunDetailParams(
      params("status=failed,bogus&sort=bogus&page=0")
    );
    expect(state.statuses).toEqual(["failed"]);
    expect(state.sort).toBe(DEFAULT_RUN_ITEM_SORT);
    expect(state.page).toBe(1);
  });

  it("de-duplicates repeated statuses", () => {
    expect(parseRunDetailParams(params("status=failed,failed")).statuses).toEqual(
      ["failed"]
    );
  });
});

describe("patchRunDetailParams", () => {
  it("drops the default sort and page 1", () => {
    const next = patchRunDetailParams(params("sort=-status&page=4"), {
      sort: DEFAULT_RUN_ITEM_SORT,
      page: 1,
    });
    expect(next.get("sort")).toBeNull();
    expect(next.get("page")).toBeNull();
  });

  it("writes a non-default sort", () => {
    const next = patchRunDetailParams(params(""), { sort: "-updated_at" });
    expect(next.get("sort")).toBe("-updated_at");
  });

  it("opens and closes the drawer without touching the page", () => {
    const open = patchRunDetailParams(params("page=3"), { item: "i-1" });
    expect(open.get("item")).toBe("i-1");
    expect(open.get("page")).toBe("3");

    const close = patchRunDetailParams(open, { item: null });
    expect(close.get("item")).toBeNull();
    expect(close.get("page")).toBe("3");
  });

  it("resets the page when a filter or the search changes", () => {
    expect(
      patchRunDetailParams(params("page=3"), { statuses: ["failed"] }).get("page")
    ).toBeNull();
    expect(
      patchRunDetailParams(params("page=3"), { assignee: "u-1" }).get("page")
    ).toBeNull();
    expect(
      patchRunDetailParams(params("page=3"), { suite: "s-1" }).get("page")
    ).toBeNull();
    expect(
      patchRunDetailParams(params("page=3"), { query: "card" }).get("page")
    ).toBeNull();
  });

  it("keeps an explicit page patch (pagination)", () => {
    expect(
      patchRunDetailParams(params("page=1"), { page: 2 }).get("page")
    ).toBe("2");
  });

  it("clears a filter when the value is empty or null", () => {
    expect(
      patchRunDetailParams(params("status=failed"), { statuses: [] }).get("status")
    ).toBeNull();
    expect(
      patchRunDetailParams(params("assignee=u-1"), { assignee: null }).get(
        "assignee"
      )
    ).toBeNull();
    expect(
      patchRunDetailParams(params("query=card"), { query: "" }).get("query")
    ).toBeNull();
  });

  it("preserves unrelated parameters such as project", () => {
    const next = patchRunDetailParams(params("project=p-1"), { item: "i-1" });
    expect(next.get("project")).toBe("p-1");
  });
});

describe("sort mapping", () => {
  it.each([
    ["position", "asc", "position"],
    ["case_display_id", "asc", "case_display_id"],
    ["case_display_id", "desc", "-case_display_id"],
    ["status", "asc", "status"],
    ["updated_at", "desc", "-updated_at"],
  ] as const)("maps %s %s to %s", (key, dir, expected) => {
    expect(runItemSortParam(key, dir)).toBe(expected);
  });

  it("falls back to the default for unsortable columns", () => {
    expect(runItemSortParam("title", "desc")).toBe(DEFAULT_RUN_ITEM_SORT);
    expect(runItemSortParam("assignee", "asc")).toBe(DEFAULT_RUN_ITEM_SORT);
  });

  it("round-trips through DataTable sort state", () => {
    expect(runItemSortState("-status")).toEqual({ key: "status", dir: "desc" });
    expect(runItemSortState("position")).toEqual({
      key: "position",
      dir: "asc",
    });
    expect(runItemSortParam("position", runItemSortState("position").dir)).toBe(
      "position"
    );
  });

  it("guards known sorts only", () => {
    expect(isRunItemSort("-updated_at")).toBe(true);
    expect(isRunItemSort("title")).toBe(false);
  });
});