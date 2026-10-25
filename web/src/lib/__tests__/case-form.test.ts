import {
  CASE_ESTIMATE_MAX,
  CASE_TAGS_MAX,
  buildCreateCaseInput,
  buildUpdateCaseInput,
  caseFormFromDetail,
  caseFormServerErrors,
  emptyCaseForm,
  formatEstimateInput,
  hasCaseFormErrors,
  parseEstimateInput,
  parseTagsInput,
  validateCaseForm,
  type CaseFormValues,
} from "@/lib/case-form";
import { ApiError } from "@/lib/api-error";
import type { CaseDetail } from "@/lib/api-types";

/**
 * Unit tests for the case editor's pure layer (card 3.3). The rules under
 * test are the ones in docs/api-cases.md § Validation; the component tests
 * only check that these results reach the DOM.
 */

function values(overrides: Partial<CaseFormValues> = {}): CaseFormValues {
  return {
    ...emptyCaseForm("s-1"),
    title: "Pay with a saved card",
    ...overrides,
  };
}

function detail(overrides: Partial<CaseDetail> = {}): CaseDetail {
  return {
    id: "c-1",
    project_id: "p-1",
    suite_id: "s-1",
    case_number: 42,
    display_id: "C42",
    title: "Pay with a saved card",
    preconditions: "Customer has a saved card",
    steps: [
      { position: 1, text: "Open checkout", expected_result: "Cart total is shown" },
      { position: 2, text: "Pay", expected_result: null },
    ],
    priority: "high",
    type: "functional",
    tags: ["payments", "smoke"],
    estimate_minutes: 15,
    created_by: "u-1",
    updated_by: "u-1",
    created_at: "2026-10-25T09:00:00Z",
    updated_at: "2026-10-25T09:12:00Z",
    ...overrides,
  };
}

describe("parseTagsInput", () => {
  it("trims, lowercases and de-duplicates", () => {
    expect(parseTagsInput(" Payments, smoke ,, PAYMENTS ")).toEqual({
      tags: ["payments", "smoke"],
    });
  });

  it("treats blank input as no tags", () => {
    expect(parseTagsInput("   ")).toEqual({ tags: [] });
  });

  it(`rejects more than ${CASE_TAGS_MAX} tags`, () => {
    const raw = Array.from({ length: CASE_TAGS_MAX + 1 }, (_, i) => `t${i}`).join(",");
    const parsed = parseTagsInput(raw);
    expect(parsed.error).toBe(`Use at most ${CASE_TAGS_MAX} tags.`);
  });

  it("rejects a tag longer than 30 characters", () => {
    const parsed = parseTagsInput("a".repeat(31));
    expect(parsed.error).toBe("Each tag must be at most 30 characters.");
  });
});

describe("parseEstimateInput", () => {
  it.each([
    ["90", 90],
    ["45m", 45],
    ["2h", 120],
    ["1h 30m", 90],
    ["1h30m", 90],
  ])("parses %s as %i minutes", (raw, minutes) => {
    expect(parseEstimateInput(raw).minutes).toBe(minutes);
  });

  it("treats empty input as no estimate", () => {
    expect(parseEstimateInput("  ")).toEqual({ minutes: null });
  });

  it("rejects free text with a hint", () => {
    const parsed = parseEstimateInput("about an hour");
    expect(parsed.minutes).toBeNull();
    expect(parsed.error).toContain("1h 30m");
  });

  it(`rejects more than ${CASE_ESTIMATE_MAX} minutes`, () => {
    const parsed = parseEstimateInput(String(CASE_ESTIMATE_MAX + 1));
    expect(parsed.error).toContain("at most");
  });
});

describe("formatEstimateInput", () => {
  it.each([
    [90, "1h 30m"],
    [60, "1h"],
    [45, "45m"],
    [0, "0m"],
    [null, ""],
  ])("formats %s as %p", (minutes, expected) => {
    expect(formatEstimateInput(minutes)).toBe(expected);
  });
});

describe("validateCaseForm", () => {
  it("requires a suite and a title", () => {
    const errors = validateCaseForm(emptyCaseForm(""));
    expect(errors.suite_id).toBe("Choose a suite.");
    expect(errors.title).toBe("Title is required.");
    expect(hasCaseFormErrors(errors)).toBe(true);
  });

  it("accepts the minimal valid form", () => {
    expect(hasCaseFormErrors(validateCaseForm(values()))).toBe(false);
  });

  it("flags an empty step but allows an empty expected result", () => {
    const errors = validateCaseForm(
      values({
        steps: [
          { text: "Open checkout", expected_result: "" },
          { text: "   ", expected_result: "" },
        ],
      })
    );
    expect(errors.steps?.[0]).toEqual({});
    expect(errors.steps?.[1]?.text).toBe("Step text is required.");
    expect(errors.steps?.[1]?.expected_result).toBeUndefined();
  });

  it("reports the steps-level message when over the cap", () => {
    const steps = Array.from({ length: 51 }, () => ({
      text: "step",
      expected_result: "",
    }));
    const errors = validateCaseForm(values({ steps }));
    expect(errors.stepsMessage).toBe("A case can have at most 50 steps.");
  });

  it("surfaces tag and estimate parse errors on their fields", () => {
    const errors = validateCaseForm(
      values({ tags: "a".repeat(31), estimate: "soon" })
    );
    expect(errors.tags).toBeTruthy();
    expect(errors.estimate).toBeTruthy();
  });
});

describe("caseFormFromDetail", () => {
  it("round-trips every field, including estimate display", () => {
    expect(caseFormFromDetail(detail())).toEqual({
      suite_id: "s-1",
      title: "Pay with a saved card",
      preconditions: "Customer has a saved card",
      steps: [
        { text: "Open checkout", expected_result: "Cart total is shown" },
        { text: "Pay", expected_result: "" },
      ],
      priority: "high",
      type: "functional",
      tags: "payments, smoke",
      estimate: "15m",
    });
  });

  it("maps a missing suite and estimate to empty values", () => {
    const form = caseFormFromDetail(
      detail({ suite_id: null, estimate_minutes: null, preconditions: null })
    );
    expect(form.suite_id).toBe("");
    expect(form.estimate).toBe("");
    expect(form.preconditions).toBe("");
  });
});

describe("buildCreateCaseInput", () => {
  it("trims and omits empty optional fields", () => {
    const input = buildCreateCaseInput(
      values({
        title: "  Pay  ",
        preconditions: "   ",
        steps: [{ text: " Open checkout ", expected_result: "  " }],
        tags: " Smoke , smoke, ",
        estimate: "1h",
      })
    );
    expect(input).toEqual({
      suite_id: "s-1",
      title: "Pay",
      priority: "medium",
      type: "functional",
      tags: ["smoke"],
      steps: [{ text: "Open checkout", expected_result: null }],
      estimate_minutes: 60,
    });
    expect(input).not.toHaveProperty("preconditions");
  });
});

describe("buildUpdateCaseInput", () => {
  it("returns an empty body when nothing changed", () => {
    const original = detail();
    expect(buildUpdateCaseInput(caseFormFromDetail(original), original)).toEqual(
      {}
    );
  });

  it("sends only the changed field", () => {
    const original = detail();
    const form = { ...caseFormFromDetail(original), title: "Pay with a new card" };
    expect(buildUpdateCaseInput(form, original)).toEqual({
      title: "Pay with a new card",
    });
  });

  it("clears preconditions with null", () => {
    const original = detail();
    const form = { ...caseFormFromDetail(original), preconditions: "" };
    expect(buildUpdateCaseInput(form, original)).toEqual({ preconditions: null });
  });

  it("ignores tag order and whitespace-only step differences", () => {
    const original = detail();
    const form = {
      ...caseFormFromDetail(original),
      tags: "smoke,payments",
      steps: [
        { text: " Open checkout ", expected_result: "Cart total is shown" },
        { text: "Pay", expected_result: "" },
      ],
    };
    expect(buildUpdateCaseInput(form, original)).toEqual({});
  });

  it("includes suite_id when the case moved in the editor", () => {
    const original = detail();
    const form = { ...caseFormFromDetail(original), suite_id: "s-2" };
    expect(buildUpdateCaseInput(form, original)).toEqual({ suite_id: "s-2" });
  });
});

describe("caseFormServerErrors", () => {
  it("maps bracketed step details back onto the row", () => {
    const err = new ApiError({
      code: "VALIDATION_ERROR",
      message: "Validation failed",
      status: 400,
      details: [
        { field: "steps[1].text", issue: "Step text is required." },
        { field: "title", issue: "Title is taken." },
      ],
    });
    const mapped = caseFormServerErrors(err);
    expect(mapped.form).toBeNull();
    expect(mapped.errors.title).toBe("Title is taken.");
    expect(mapped.errors.steps?.[1]?.text).toBe("Step text is required.");
  });

  it("maps roots-level details", () => {
    const err = new ApiError({
      code: "VALIDATION_ERROR",
      message: "Validation failed",
      status: 400,
      details: [
        { field: "steps", issue: "A case can have at most 50 steps." },
        { field: "estimate_minutes", issue: "Estimate is too large." },
      ],
    });
    const mapped = caseFormServerErrors(err);
    expect(mapped.errors.stepsMessage).toBe("A case can have at most 50 steps.");
    expect(mapped.errors.estimate).toBe("Estimate is too large.");
  });

  it("keeps archived-project conflicts at form level", () => {
    const err = new ApiError({
      code: "CONFLICT",
      message: "This project is archived.",
      status: 409,
    });
    expect(caseFormServerErrors(err)).toEqual({
      errors: {},
      form: "This project is archived.",
    });
  });

  it("handles non-API failures with a generic message", () => {
    expect(caseFormServerErrors(new Error("boom")).form).toBe(
      "Something went wrong. Please try again."
    );
  });
});
