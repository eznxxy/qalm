import {
  DEFAULT_REPORT_DAYS,
  parseReportParams,
  patchReportParams,
} from "../report-url";

const PLAN = "018f1c31-9d4e-7b2a-8c1f-2a3b4c5d6e7f";

describe("parseReportParams", () => {
  it("defaults to 30 days, no filters and page 1", () => {
    expect(parseReportParams(new URLSearchParams())).toEqual({
      project: null, days: DEFAULT_REPORT_DAYS,
      planId: null, milestoneId: null, status: null, page: 1,
    });
  });

  it("accepts the four presets and falls back to 30 for anything else", () => {
    for (const days of [1, 7, 14, 30]) {
      expect(parseReportParams(new URLSearchParams(`days=${days}`)).days).toBe(days);
    }
    expect(parseReportParams(new URLSearchParams("days=99")).days).toBe(30);
    expect(parseReportParams(new URLSearchParams("days=3")).days).toBe(30);
    expect(parseReportParams(new URLSearchParams("days=abc")).days).toBe(30);
  });

  it("keeps none and valid UUIDs, drops malformed filters and status", () => {
    const state = parseReportParams(
      new URLSearchParams(`plan=none&milestone=not-a-uuid&status=archived&page=0`)
    );
    expect(state.planId).toBe("none");
    expect(state.milestoneId).toBeNull();
    expect(state.status).toBeNull();
    expect(state.page).toBe(1);
    expect(parseReportParams(new URLSearchParams(`plan=${PLAN}`)).planId).toBe(PLAN);
  });
});

describe("patchReportParams", () => {
  it("omits the 30-day default and page 1 from the canonical URL", () => {
    const params = patchReportParams(new URLSearchParams(), {
      project: "p-1", days: 30, page: 1,
    });
    expect(params.get("project")).toBe("p-1");
    expect(params.has("days")).toBe(false);
    expect(params.has("page")).toBe(false);
  });

  it("writes a non-default window and a later page", () => {
    const params = patchReportParams(new URLSearchParams("project=p-1"), {
      project: "p-1", days: 7, page: 3,
    });
    expect(params.get("days")).toBe("7");
    expect(params.get("page")).toBe("3");
  });

  it("resets to page 1 when a filter changes, but not when paging", () => {
    const filtered = patchReportParams(new URLSearchParams("project=p-1&page=3"), {
      planId: "none",
    });
    expect(filtered.get("plan")).toBe("none");
    expect(filtered.has("page")).toBe(false);

    const paged = patchReportParams(new URLSearchParams("project=p-1"), { page: 2 });
    expect(paged.get("page")).toBe("2");
  });

  it("removes a filter when it is cleared", () => {
    const params = patchReportParams(new URLSearchParams("plan=none&milestone=none"), {
      planId: null, milestoneId: null,
    });
    expect(params.has("plan")).toBe(false);
    expect(params.has("milestone")).toBe(false);
  });
});