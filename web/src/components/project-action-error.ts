"use client";

/**
 * Readable states for failed project actions, per docs/api-conventions.md §
 * Error format: 403 FORBIDDEN (role may not do this), 404 NOT_FOUND (unknown
 * id or archived project hidden from this role), 409 CONFLICT, plus network
 * failures. Never a crash, never a raw code dump.
 */
import { ApiError } from "@/lib/api-error";

export function projectActionError(err: unknown, action: string): string {
  if (err instanceof ApiError) {
    if (err.status === 403) {
      return `You do not have permission to ${action} this project.`;
    }
    if (err.status === 404) {
      return "Project not found. It may have been archived — archived projects are only visible to Admins.";
    }
    if (err.status === 409) {
      return err.message;
    }
    return err.message;
  }
  return `Could not ${action} the project. Please try again.`;
}
