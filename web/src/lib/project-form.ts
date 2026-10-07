/**
 * Client-side form validation + server error mapping for the project forms.
 * Validation mirrors the contract rules in docs/api-projects.md § Validation;
 * error mapping follows docs/api-conventions.md § Error format (details[] with
 * field names, 409 CONFLICT naming the duplicated field).
 */
import { ApiError } from "./api-error";
import {
  isValidProjectKey,
  normalizeProjectKey,
  PROJECT_DESCRIPTION_MAX_LENGTH,
  PROJECT_KEY_MAX_LENGTH,
  PROJECT_NAME_MAX_LENGTH,
} from "./project-key";

export type ProjectFormField = "name" | "key" | "description";

export interface ProjectFormValues {
  name: string;
  key: string;
  description: string;
}

export type ProjectFormErrors = Partial<Record<ProjectFormField, string>>;

/**
 * Client-side validation with the same rules the server enforces. Returns an
 * error per offending field; an empty object means the form is submittable.
 */
export function validateProjectForm(values: ProjectFormValues): ProjectFormErrors {
  const errors: ProjectFormErrors = {};
  const name = values.name.trim();
  if (!name) {
    errors.name = "Name is required.";
  } else if (name.length > PROJECT_NAME_MAX_LENGTH) {
    errors.name = `Name must be at most ${PROJECT_NAME_MAX_LENGTH} characters.`;
  }

  const key = normalizeProjectKey(values.key);
  if (!values.key.trim()) {
    errors.key = "Key is required.";
  } else if (!isValidProjectKey(key)) {
    errors.key = `Key must be 2-${PROJECT_KEY_MAX_LENGTH} characters, an uppercase letter first, then A-Z or 0-9.`;
  }

  if (values.description.trim().length > PROJECT_DESCRIPTION_MAX_LENGTH) {
    errors.description = `Description must be at most ${PROJECT_DESCRIPTION_MAX_LENGTH} characters.`;
  }
  return errors;
}

export interface ProjectFormServerErrors {
  fields: ProjectFormErrors;
  /** Anything not attributable to a single field (403, 500, network…). */
  form: string | null;
}

const FIELD_NAMES = new Set(["name", "key", "description"]);

/**
 * Maps a thrown error to per-field messages plus a form-level fallback:
 * - 400 VALIDATION_ERROR → details[] spread onto their fields
 * - 409 CONFLICT → details[] name the duplicated field (name/key)
 * - everything else → readable form-level message
 */
export function projectFormServerErrors(err: unknown): ProjectFormServerErrors {
  const fields: ProjectFormErrors = {};
  if (err instanceof ApiError) {
    for (const detail of err.details ?? []) {
      if (detail.field && FIELD_NAMES.has(detail.field)) {
        fields[detail.field as ProjectFormField] = detail.issue;
      }
    }
    if (Object.keys(fields).length > 0) return { fields, form: null };
    return { fields, form: err.message };
  }
  return { fields, form: "Something went wrong. Please try again." };
}
