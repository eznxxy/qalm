/**
 * Client-side mirror of the plans role matrix (docs/api-plans.md). Creating,
 * editing and deleting plans is Admin/Lead; every role may read. These helpers
 * only decide what the UI renders — the API enforces the same matrix, so this
 * is defense-in-depth, not the security boundary.
 */
import type { Role } from "./api-types";

/** POST/PATCH/DELETE plans — Admin, Lead. */
export function canWritePlans(role: Role): boolean {
  return role === "admin" || role === "lead";
}