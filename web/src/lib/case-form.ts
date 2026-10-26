/**
 * Client-side form state, validation and payload building for the case
 * editor. Rules mirror docs/api-cases.md § Validation; server details[]
 * fields (including `steps[1].text`) are mapped back onto the form.
 */
import type {
  CaseDetail,
  CaseStepInput,
  CaseType,
  CreateCaseInput,
  Priority,
  UpdateCaseInput,
} from "./api-types";
import { ApiError } from "./api-error";

export const CASE_TITLE_MAX = 200;
export const CASE_PRECONDITIONS_MAX = 2_000;
export const CASE_STEPS_MAX = 50;
export const CASE_STEP_TEXT_MAX = 500;
export const CASE_STEP_EXPECTED_MAX = 500;
export const CASE_TAGS_MAX = 20;
export const CASE_TAG_MAX = 30;
export const CASE_ESTIMATE_MAX = 10_080;

export interface CaseFormStep {
  text: string;
  expected_result: string;
}

export interface CaseFormValues {
  suite_id: string;
  title: string;
  preconditions: string;
  steps: CaseFormStep[];
  priority: Priority;
  type: CaseType;
  /** Raw comma-separated input; parsed on submit. */
  tags: string;
  /** Raw "90" / "1h 30m" input; parsed on submit. */
  estimate: string;
}

export interface CaseStepErrors {
  text?: string;
  expected_result?: string;
}

export interface CaseFormErrors {
  suite_id?: string;
  title?: string;
  preconditions?: string;
  priority?: string;
  type?: string;
  tags?: string;
  estimate?: string;
  /** Per-row step errors, index-aligned with the form. */
  steps?: CaseStepErrors[];
  /** Error for the steps array as a whole (e.g. more than 50). */
  stepsMessage?: string;
}

export interface ParsedTags {
  tags: string[];
  error?: string;
}

/** Split, trim, lowercase and de-duplicate the comma-separated tag input. */
export function parseTagsInput(raw: string): ParsedTags {
  const tags = Array.from(
    new Set(
      raw
        .split(",")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
    )
  );
  if (tags.length > CASE_TAGS_MAX) {
    return { tags, error: `Use at most ${CASE_TAGS_MAX} tags.` };
  }
  if (tags.some((tag) => tag.length > CASE_TAG_MAX)) {
    return {
      tags,
      error: `Each tag must be at most ${CASE_TAG_MAX} characters.`,
    };
  }
  return { tags };
}

export interface ParsedEstimate {
  minutes: number | null;
  error?: string;
}

const ESTIMATE_HINT =
  'Enter minutes ("90") or hours and minutes ("1h 30m").';

/**
 * Accepts a plain minute count, `90m`, `1h`, `1h 30m` (spacing optional).
 * Empty input means "no estimate" (null).
 */
export function parseEstimateInput(raw: string): ParsedEstimate {
  const value = raw.trim();
  if (!value) return { minutes: null };

  let minutes: number;
  const hours = /^(\d+)\s*h(?:\s*(\d+)\s*m)?$/i.exec(value);
  const mins = /^(\d+)\s*m$/i.exec(value);
  if (hours) {
    minutes = Number(hours[1]) * 60 + Number(hours[2] ?? 0);
  } else if (mins) {
    minutes = Number(mins[1]);
  } else if (/^\d+$/.test(value)) {
    minutes = Number(value);
  } else {
    return { minutes: null, error: ESTIMATE_HINT };
  }

  if (!Number.isSafeInteger(minutes) || minutes < 0) {
    return { minutes: null, error: ESTIMATE_HINT };
  }
  if (minutes > CASE_ESTIMATE_MAX) {
    return {
      minutes: null,
      error: `Estimate must be at most ${CASE_ESTIMATE_MAX.toLocaleString()} minutes.`,
    };
  }
  return { minutes };
}

/** Minutes → the editor's compact display ("1h 30m", "45m", ""). */
export function formatEstimateInput(minutes: number | null): string {
  if (minutes === null) return "";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours > 0 && rest > 0) return `${hours}h ${rest}m`;
  if (hours > 0) return `${hours}h`;
  return `${rest}m`;
}

export function emptyCaseForm(
  suiteId: string,
  priority: Priority = "medium",
  type: CaseType = "functional"
): CaseFormValues {
  return {
    suite_id: suiteId,
    title: "",
    preconditions: "",
    steps: [],
    priority,
    type,
    tags: "",
    estimate: "",
  };
}

export function caseFormFromDetail(detail: CaseDetail): CaseFormValues {
  return {
    suite_id: detail.suite_id ?? "",
    title: detail.title,
    preconditions: detail.preconditions ?? "",
    steps: detail.steps.map((step) => ({
      text: step.text,
      expected_result: step.expected_result ?? "",
    })),
    priority: detail.priority,
    type: detail.type,
    tags: detail.tags.join(", "),
    estimate: formatEstimateInput(detail.estimate_minutes),
  };
}

/**
 * True when `values` differs from `baseline` — i.e. the form holds input that
 * would be lost if it were dismissed. Compared on the raw form strings (not
 * the parsed payload), so a half-typed tag or estimate still counts, and
 * spaces count as input (deleting them again returns to pristine).
 */
export function isCaseFormDirty(
  values: CaseFormValues,
  baseline: CaseFormValues
): boolean {
  if (
    values.suite_id !== baseline.suite_id ||
    values.title !== baseline.title ||
    values.preconditions !== baseline.preconditions ||
    values.priority !== baseline.priority ||
    values.type !== baseline.type ||
    values.tags !== baseline.tags ||
    values.estimate !== baseline.estimate ||
    values.steps.length !== baseline.steps.length
  ) {
    return true;
  }
  return values.steps.some((step, index) => {
    const original = baseline.steps[index];
    return (
      original === undefined ||
      step.text !== original.text ||
      step.expected_result !== original.expected_result
    );
  });
}

/** Validation mirroring the contract; an empty object means submittable. */
export function validateCaseForm(values: CaseFormValues): CaseFormErrors {
  const errors: CaseFormErrors = {};

  if (!values.suite_id.trim()) {
    errors.suite_id = "Choose a suite.";
  }

  const title = values.title.trim();
  if (!title) {
    errors.title = "Title is required.";
  } else if (title.length > CASE_TITLE_MAX) {
    errors.title = `Title must be at most ${CASE_TITLE_MAX} characters.`;
  }

  if (values.preconditions.trim().length > CASE_PRECONDITIONS_MAX) {
    errors.preconditions = `Preconditions must be at most ${CASE_PRECONDITIONS_MAX.toLocaleString()} characters.`;
  }

  if (!values.priority) errors.priority = "Choose a priority.";
  if (!values.type) errors.type = "Choose a type.";

  if (values.steps.length > CASE_STEPS_MAX) {
    errors.stepsMessage = `A case can have at most ${CASE_STEPS_MAX} steps.`;
  }
  const stepErrors = values.steps.map((step): CaseStepErrors => {
    const row: CaseStepErrors = {};
    const text = step.text.trim();
    if (!text) row.text = "Step text is required.";
    else if (text.length > CASE_STEP_TEXT_MAX) {
      row.text = `Step text must be at most ${CASE_STEP_TEXT_MAX} characters.`;
    }
    if (step.expected_result.trim().length > CASE_STEP_EXPECTED_MAX) {
      row.expected_result = `Expected result must be at most ${CASE_STEP_EXPECTED_MAX} characters.`;
    }
    return row;
  });
  if (stepErrors.some((row) => row.text || row.expected_result)) {
    errors.steps = stepErrors;
  }

  const tags = parseTagsInput(values.tags);
  if (tags.error) errors.tags = tags.error;

  const estimate = parseEstimateInput(values.estimate);
  if (estimate.error) errors.estimate = estimate.error;

  return errors;
}

export function hasCaseFormErrors(errors: CaseFormErrors): boolean {
  return Object.values(errors).some((value) => {
    if (Array.isArray(value)) {
      return value.some((row) => row.text || row.expected_result);
    }
    return Boolean(value);
  });
}

function cleanSteps(steps: readonly CaseFormStep[]): CaseStepInput[] {
  return steps.map((step) => {
    const expected = step.expected_result.trim();
    return {
      text: step.text.trim(),
      expected_result: expected ? expected : null,
    };
  });
}

/** Payload for POST /projects/:projectId/cases (assumes valid form state). */
export function buildCreateCaseInput(values: CaseFormValues): CreateCaseInput {
  const preconditions = values.preconditions.trim();
  const estimate = parseEstimateInput(values.estimate);
  const tags = parseTagsInput(values.tags);
  const input: CreateCaseInput = {
    suite_id: values.suite_id,
    title: values.title.trim(),
    priority: values.priority,
    type: values.type,
    tags: tags.tags,
    steps: cleanSteps(values.steps),
  };
  if (preconditions) input.preconditions = preconditions;
  if (estimate.minutes !== null) input.estimate_minutes = estimate.minutes;
  return input;
}

function sameSteps(a: readonly CaseFormStep[], b: readonly CaseFormStep[]): boolean {
  return JSON.stringify(cleanSteps(a)) === JSON.stringify(cleanSteps(b));
}

function sameTags(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((tag, index) => tag === right[index]);
}

/**
 * PATCH body containing only what changed (the contract rejects empty
 * bodies; callers treat `{}` as "nothing to save").
 */
export function buildUpdateCaseInput(
  values: CaseFormValues,
  original: CaseDetail
): UpdateCaseInput {
  const body: UpdateCaseInput = {};
  const preconditions = values.preconditions.trim();
  const tags = parseTagsInput(values.tags).tags;
  const estimate = parseEstimateInput(values.estimate).minutes;

  if (values.title.trim() !== original.title) body.title = values.title.trim();
  if ((preconditions || null) !== original.preconditions) {
    body.preconditions = preconditions || null;
  }
  if (values.priority !== original.priority) body.priority = values.priority;
  if (values.type !== original.type) body.type = values.type;
  if (!sameTags(tags, original.tags)) body.tags = tags;
  if (estimate !== original.estimate_minutes) body.estimate_minutes = estimate;
  if (values.suite_id && values.suite_id !== original.suite_id) {
    body.suite_id = values.suite_id;
  }
  const originalSteps = original.steps.map((step) => ({
    text: step.text,
    expected_result: step.expected_result ?? "",
  }));
  if (!sameSteps(values.steps, originalSteps)) body.steps = cleanSteps(values.steps);
  return body;
}

export interface CaseFormServerErrors {
  errors: CaseFormErrors;
  /** Anything not attributable to a field (403, 409, 500, network…). */
  form: string | null;
}

const SIMPLE_FIELDS = new Set([
  "suite_id",
  "title",
  "preconditions",
  "priority",
  "type",
  "tags",
]);

/**
 * Maps a thrown error onto the form:
 * - 400 VALIDATION_ERROR → details[] spread onto fields, including
 *   `steps[1].text` back onto the offending row
 * - 409 CONFLICT (archived project) → form-level message
 * - everything else → readable form-level message
 */
export function caseFormServerErrors(err: unknown): CaseFormServerErrors {
  const errors: CaseFormErrors = {};
  if (!(err instanceof ApiError)) {
    return { errors, form: "Something went wrong. Please try again." };
  }

  let mapped = false;
  for (const detail of err.details ?? []) {
    const field = detail.field;
    if (!field) continue;
    const stepMatch = /^steps\[(\d+)\]\.(text|expected_result)$/.exec(field);
    if (stepMatch) {
      const index = Number(stepMatch[1]);
      const key = stepMatch[2] as keyof CaseStepErrors;
      errors.steps = errors.steps ?? [];
      while (errors.steps.length <= index) errors.steps.push({});
      errors.steps[index]![key] = detail.issue;
      mapped = true;
      continue;
    }
    if (field === "steps") {
      errors.stepsMessage = detail.issue;
      mapped = true;
      continue;
    }
    if (field === "estimate_minutes") {
      errors.estimate = detail.issue;
      mapped = true;
      continue;
    }
    if (SIMPLE_FIELDS.has(field)) {
      (errors as Record<string, string>)[field] = detail.issue;
      mapped = true;
    }
  }

  if (mapped) return { errors, form: null };
  return { errors, form: err.message || "Could not save the case." };
}
