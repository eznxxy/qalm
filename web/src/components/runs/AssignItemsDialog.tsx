"use client";

/**
 * AssignItemsDialog — the run header's [Assign] and the items table's bulk
 * assign (docs/DESIGN.md §4.4, docs/api-runs.md § POST /runs/:id/assign).
 *
 * The contract assigns by `assignee_id`, so the dialog needs user ids. The only
 * user-listing endpoint is `GET /users`, which is **Admin-only** (docs/api-auth.md
 * line 92), so a Lead cannot be offered a full name picker yet. The caller
 * decides the options: Admins get every active assignable user by name; other
 * writers get the ids already present in the run (shown as short ids) and are
 * told the full list needs Admin — flagged to Daedalus, not papered over.
 *
 * `assignee_id: null` unassigns. Modal behaviour (focus trap, Escape, key
 * shield) mirrors ConfirmDialog.
 */
import { useEffect, useRef, useState, type ReactElement } from "react";
import { DisabledHint } from "@/components/ui";
import { shortActorId } from "@/lib/case-history";

export interface AssigneeOption {
  id: string;
  label: string;
}

export interface AssignItemsDialogProps {
  /** What is being assigned, e.g. "All 12 items" — named in the body copy. */
  scopeLabel: string;
  options: readonly AssigneeOption[];
  /** True when only some assignees are nameable (the full list needs Admin). */
  limited?: boolean;
  busy?: boolean;
  error?: string | null;
  /** `null` unassigns. */
  onSubmit: (assigneeId: string | null) => void;
  onCancel: () => void;
}

/** The select's "unassign" choice; a real user id is never the empty string. */
const UNASSIGN = "";

export function AssignItemsDialog({
  scopeLabel,
  options,
  limited = false,
  busy = false,
  error,
  onSubmit,
  onCancel,
}: AssignItemsDialogProps): ReactElement {
  const [value, setValue] = useState<string>(UNASSIGN);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>("select, button")?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" && event.key !== "Tab") {
        event.stopPropagation();
        return;
      }
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancel();
        return;
      }
      if (!dialog) return;
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>("select, button:not(:disabled)")
      );
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previous?.focus();
    };
  }, [onCancel]);

  return (
    <div className="dialog-overlay">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="assign-dialog-title"
        aria-describedby="assign-dialog-body"
        className="dialog assign-dialog"
      >
        <h2 id="assign-dialog-title">Assign items</h2>
        <p id="assign-dialog-body" className="field-hint">
          {scopeLabel}. Pick an assignee, or unassign.
        </p>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="field">
          <label htmlFor="assign-dialog-user">Assignee</label>
          <select
            id="assign-dialog-user"
            value={value}
            disabled={busy}
            onChange={(event) => setValue(event.target.value)}
          >
            <option value={UNASSIGN}>Unassign</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          {limited && (
            <p className="field-hint">
              Only people already on this run can be named here — the full user
              list needs the Admin role.
            </p>
          )}
        </div>

        <div className="button-row dialog-actions">
          <DisabledHint hint={busy ? "Assigning — please wait" : null}>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => onSubmit(value === UNASSIGN ? null : value)}
            >
              {busy ? "Assigning…" : "Assign"}
            </button>
          </DisabledHint>
          <DisabledHint hint={busy ? "Can't cancel while assigning" : null}>
            <button type="button" disabled={busy} onClick={onCancel}>
              Cancel
            </button>
          </DisabledHint>
        </div>
      </div>
    </div>
  );
}

/** Builds options for the ids a run already mentions (non-Admin writers). */
export function existingAssigneeOptions(
  ids: readonly string[]
): AssigneeOption[] {
  return Array.from(new Set(ids))
    .filter(Boolean)
    .map((id) => ({ id, label: shortActorId(id) }));
}