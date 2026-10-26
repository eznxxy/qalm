/**
 * Readable rendering for the case history tab (docs/api-cases.md §
 * GET /cases/:id/history). Audit rows carry `changes` as arbitrary JSON with
 * `{ from, to }` pairs for changed fields; the drawer renders one line per
 * field and never dumps raw JSON at the user.
 */
import type { CaseHistoryAction } from "./api-types";

export const CASE_ACTION_LABELS: Record<CaseHistoryAction, string> = {
  created: "Created",
  updated: "Updated",
  moved: "Moved",
  deleted: "Deleted",
};

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  preconditions: "Preconditions",
  steps: "Steps",
  priority: "Priority",
  type: "Type",
  tags: "Tags",
  estimate_minutes: "Estimate",
  suite_id: "Suite",
  case_number: "Case number",
};

export function caseFieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field.replace(/_/g, " ");
}

/** Renders one side of a change with field-appropriate copy. */
export function formatChangeValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "none";
  if (field === "steps" && typeof value === "number") {
    return `${value} step${value === 1 ? "" : "s"}`;
  }
  if (field === "estimate_minutes" && typeof value === "number") {
    return `${value} min`;
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(", ") : "none";
  }
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "object") {
    // Nested pair we do not model — keep it one line and readable.
    return Object.entries(value as Record<string, unknown>)
      .map(([key, nested]) => `${key}: ${formatChangeValue(key, nested)}`)
      .join(", ");
  }
  return String(value);
}

export interface CaseChangeLine {
  field: string;
  label: string;
  text: string;
}

/** One line per changed field; `{ from, to }` becomes "From → to". */
export function describeCaseChanges(
  changes: Record<string, unknown>
): CaseChangeLine[] {
  return Object.entries(changes).map(([field, value]) => {
    const label = caseFieldLabel(field);
    const pair =
      value !== null && typeof value === "object" && "from" in value && "to" in value
        ? (value as { from: unknown; to: unknown })
        : null;
    const text = pair
      ? `${formatChangeValue(field, pair.from)} → ${formatChangeValue(field, pair.to)}`
      : formatChangeValue(field, value);
    return { field, label, text };
  });
}

/** Actors are ids in the contract; short ids stay scannable in the rail. */
export function shortActorId(actorId: string): string {
  return actorId.length > 8 ? `${actorId.slice(0, 8)}…` : actorId;
}
