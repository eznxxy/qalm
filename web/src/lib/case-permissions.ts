/**
 * Client-side mirror of the docs/api-suites.md and docs/api-cases.md role
 * matrices. These helpers only decide what the UI renders — the API enforces
 * the same matrix, so this is defense-in-depth, not the security boundary.
 */
import type { Role } from "./api-types";

/** POST/PATCH/DELETE suites + the order endpoint — Admin, Lead. */
export function canWriteSuites(role: Role): boolean {
  return role === "admin" || role === "lead";
}

/** POST/PATCH/DELETE cases + bulk move — Admin, Lead. */
export function canWriteCases(role: Role): boolean {
  return role === "admin" || role === "lead";
}
