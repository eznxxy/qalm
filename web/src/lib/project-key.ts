/**
 * Project key helpers mirroring docs/api-projects.md § Validation and the
 * PRD-projects.md key rule (auto-suggest from the name, user-editable).
 * The resource types live in api-types.ts.
 */

/** Contract validation rules, docs/api-projects.md § Validation. */
export const PROJECT_NAME_MAX_LENGTH = 100;
export const PROJECT_KEY_MAX_LENGTH = 10;
export const PROJECT_KEY_MIN_LENGTH = 2;
export const PROJECT_DESCRIPTION_MAX_LENGTH = 500;
/** `^[A-Z][A-Z0-9]*$` — uppercase letter first, then A–Z or 0–9. */
export const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9]*$/;

/**
 * Normalizes a project key the way the server does: trim, then uppercase.
 * Lowercase input is normalized before validation (contract § Validation).
 */
export function normalizeProjectKey(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * True when a normalized key satisfies the contract rules: 2–10 chars,
 * `^[A-Z][A-Z0-9]*$`. Client-side mirror of the server DTO validation.
 */
export function isValidProjectKey(key: string): boolean {
  return (
    key.length >= PROJECT_KEY_MIN_LENGTH &&
    key.length <= PROJECT_KEY_MAX_LENGTH &&
    PROJECT_KEY_PATTERN.test(key)
  );
}

/**
 * Auto-suggests a key from a project name per PRD-projects.md: the first
 * letters of the words, uppercased. When the initials run too short for a
 * valid key (fewer than 2 characters — e.g. single-word names), the leading
 * alphanumeric characters of the name fill the key instead; the result is
 * always clamped to the 10-char maximum. Returns "" when the name has no
 * letters or digits at all (the user must type one).
 */
export function suggestProjectKey(rawName: string): string {
  const name = rawName.trim();
  if (!name) return "";
  const initials = name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("");
  let source = initials;
  if (source.length < PROJECT_KEY_MIN_LENGTH) {
    // Single-word names: word initials alone cannot reach the 2-char minimum.
    source = name.replace(/[^A-Za-z0-9]/g, "");
  }
  return source.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, PROJECT_KEY_MAX_LENGTH);
}
