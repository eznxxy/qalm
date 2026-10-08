/**
 * Client-side mirror of the docs/api-projects.md role matrix. These helpers
 * only decide what the UI renders — the API enforces the same matrix, and
 * this is defense-in-depth, not the security boundary.
 */
import type { Role } from "./api-types";

/** POST /projects + POST /projects/:id/archive — Admin, Lead. */
export function canCreateProject(role: Role): boolean {
  return role === "admin" || role === "lead";
}

export function canArchiveProject(role: Role): boolean {
  return role === "admin" || role === "lead";
}

/** PATCH /projects/:id + POST /projects/:id/restore — Admin only. */
export function canEditProject(role: Role): boolean {
  return role === "admin";
}

export function canRestoreProject(role: Role): boolean {
  return role === "admin";
}

/** `?status=archived` on GET /projects is Admin-only per the contract. */
export function canViewArchivedProjects(role: Role): boolean {
  return role === "admin";
}
