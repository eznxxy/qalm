/**
 * Client-side mirror of the milestones role matrix (docs/api-milestones.md).
 * Creating, editing, deleting a milestone and attaching/detaching its runs are
 * Admin/Lead; every role may read. These helpers only decide what the UI
 * renders — the API enforces the same matrix, so this is defense-in-depth, not
 * the security boundary.
 */
import type { Role } from "./api-types";

/** POST/PATCH/DELETE milestones and their run membership — Admin, Lead. */
export function canWriteMilestones(role: Role): boolean {
  return role === "admin" || role === "lead";
}