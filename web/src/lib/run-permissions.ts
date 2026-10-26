/**
 * Client-side mirror of the docs/api-runs.md role matrix. Creating, editing,
 * closing/reopening and deleting runs is Admin/Lead. These helpers only decide
 * what the UI renders — the API enforces the same matrix, so this is
 * defense-in-depth, not the security boundary.
 *
 * Recording results is also allowed for assigned Testers, but that rule
 * belongs to the run-detail screen (card 3.2), not this list.
 */
import type { Role } from "./api-types";

/** POST/PATCH/DELETE runs + close/reopen — Admin, Lead. */
export function canWriteRuns(role: Role): boolean {
  return role === "admin" || role === "lead";
}