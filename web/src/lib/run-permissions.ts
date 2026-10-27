/**
 * Client-side mirror of the docs/api-runs.md role matrix. Creating, editing,
 * closing/reopening and deleting runs is Admin/Lead. These helpers only decide
 * what the UI renders — the API enforces the same matrix, so this is
 * defense-in-depth, not the security boundary.
 */
import type { Role } from "./api-types";

/** POST/PATCH/DELETE runs + close/reopen — Admin, Lead. */
export function canWriteRuns(role: Role): boolean {
  return role === "admin" || role === "lead";
}

/** POST /runs/:id/items and /runs/:id/assign (assign/reorder items). */
export function canAssignItems(role: Role): boolean {
  return role === "admin" || role === "lead";
}

/**
 * Records any result at all: Admin, Lead, or Tester. A Viewer never does.
 * Whether a specific Tester may record on a *given* item is `canRecordOnItem`.
 */
export function canRecordResults(role: Role): boolean {
  return role !== "viewer";
}

/**
 * POST /runs/:id/items/:itemId/results — Admin/Lead always; a Tester only on an
 * item assigned to them (PRD acceptance criterion 5); a Viewer never.
 */
export function canRecordOnItem(
  role: Role,
  userId: string,
  assigneeId: string | null
): boolean {
  if (role === "admin" || role === "lead") return true;
  if (role === "tester") return assigneeId !== null && assigneeId === userId;
  return false;
}

/**
 * PATCH /results/:id, POST /results/:id/attachments and DELETE /attachments/:id
 * — Admin/Lead, or the result's author (PRD Q4, docs/api-runs.md role matrix).
 */
export function canEditResult(
  role: Role,
  userId: string,
  createdBy: string
): boolean {
  if (role === "admin" || role === "lead") return true;
  if (role === "tester") return createdBy === userId;
  return false;
}