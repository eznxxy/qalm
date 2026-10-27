import {
  DEFAULT_MILESTONE_SORT,
  milestoneSortParam,
  milestoneSortState,
  parseMilestoneListParams,
  patchMilestoneListParams,
} from "@/lib/milestone-url";

/**
 * URL-as-state for the milestones list (docs/backlog-slice4-milestones.md card
 * 3.1). The product default is **All** statuses and due-date order, so the
 * canonical URL omits both — and an unknown ?status=/?sort= must fall back to
 * those defaults rather than reach the API.
 */

function parse(query: string) {
  return parseMilestoneListParams(new URLSearchParams(query));
}

describe("parseMilestoneListParams", () => {
  it("defaults to All statuses, due date and page 1", () => {
    expect(parse("")).toEqual({
      query: "",
      status: null,
      sort: DEFAULT_MILESTONE_SORT,
      page: 1,
    });
    expect(DEFAULT_MILESTONE_SORT).toBe("due_date");
  });

  it("reads the search, status, sort and page", () => {
    expect(parse("query=beta&status=completed&sort=-name&page=3")).toEqual({
      query: "beta",
      status: "completed",
      sort: "-name",
      page: 3,
    });
  });

  it("ignores an unknown status or sort instead of forwarding it", () => {
    expect(parse("status=archived&sort=title").status).toBeNull();
    expect(parse("status=archived&sort=title").sort).toBe(
      DEFAULT_MILESTONE_SORT
    );
  });

  it("never returns a page below 1", () => {
    expect(parse("page=0").page).toBe(1);
    expect(parse("page=-2").page).toBe(1);
    expect(parse("page=1.5").page).toBe(1);
    expect(parse("page=abc").page).toBe(1);
  });
});

describe("patchMilestoneListParams", () => {
  it("keeps the default status and sort out of the URL", () => {
    const params = patchMilestoneListParams(new URLSearchParams(), {
      status: null,
      sort: DEFAULT_MILESTONE_SORT,
      query: "",
    });
    expect(params.toString()).toBe("");
  });

  it("sets a real status and sort", () => {
    const params = patchMilestoneListParams(new URLSearchParams(), {
      status: "open",
      sort: "name",
    });
    expect(params.get("status")).toBe("open");
    expect(params.get("sort")).toBe("name");
  });

  it("drops page 1 and keeps later pages", () => {
    const first = patchMilestoneListParams(new URLSearchParams("page=4"), {
      page: 1,
    });
    expect(first.toString()).toBe("");
    expect(
      patchMilestoneListParams(new URLSearchParams(), { page: 2 }).get("page")
    ).toBe("2");
  });

  it("resets to page 1 when the search or filter changes", () => {
    const bySearch = patchMilestoneListParams(
      new URLSearchParams("page=3&project=p-1"),
      { query: "beta" }
    );
    expect(bySearch.get("page")).toBeNull();
    // Unrelated params survive the patch.
    expect(bySearch.get("project")).toBe("p-1");

    const byStatus = patchMilestoneListParams(
      new URLSearchParams("page=3"),
      { status: "completed" }
    );
    expect(byStatus.get("page")).toBeNull();
  });

  it("leaves the page alone when only the sort changes", () => {
    const params = patchMilestoneListParams(new URLSearchParams("page=3"), {
      sort: "-due_date",
    });
    expect(params.get("page")).toBe("3");
  });
});

describe("sort mapping", () => {
  it("round-trips every contract sort", () => {
    for (const sort of [
      "due_date",
      "-due_date",
      "created_at",
      "-created_at",
      "updated_at",
      "-updated_at",
      "name",
      "-name",
    ] as const) {
      const state = milestoneSortState(sort);
      expect(milestoneSortParam(state.key, state.dir)).toBe(sort);
    }
  });

  it("falls back to the default for a column the contract cannot sort", () => {
    expect(milestoneSortParam("run_count", "asc")).toBe(DEFAULT_MILESTONE_SORT);
  });
});