"use client";

/**
 * PlanFormDialog — "New plan" / "Edit plan" (docs/backlog-slice3-plans-runs.md
 * card 3.3, docs/api-plans.md § Validation).
 *
 * Three fields, so the rules live here rather than in a separate form module:
 * `name` required (trimmed, 1–120, unique per project — the server owns
 * uniqueness), `description` ≤ 1,000, `due_date` a plain `YYYY-MM-DD` (or
 * empty). Edit mode prefills from the plan it is handed and always submits all
 * three, so clearing a field sends `null` through the page.
 *
 * Modal behaviour (focus trap, Escape, key shield) mirrors ConfirmDialog.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { Plan } from "@/lib/api-types";
import { isDateOnly } from "@/lib/dates";

export { isDateOnly };

export const PLAN_NAME_MAX = 120;
export const PLAN_DESCRIPTION_MAX = 1000;

export interface PlanFormValues {
  name: string;
  description: string;
  /** Empty string = no due date; otherwise `YYYY-MM-DD`. */
  dueDate: string;
}

export interface PlanFormDialogProps {
  mode: "create" | "edit";
  /** Prefill for edit mode (`null` fields become empty inputs). */
  initial?: Pick<Plan, "name" | "description" | "due_date"> | null;
  busy?: boolean;
  serverFieldErrors?: {
    name?: string;
    description?: string;
    due_date?: string;
  };
  formError?: string | null;
  onSubmit: (values: PlanFormValues) => void;
  onCancel: () => void;
}

interface Errors {
  name?: string;
  description?: string;
  dueDate?: string;
}

export function PlanFormDialog({
  mode,
  initial = null,
  busy = false,
  serverFieldErrors,
  formError,
  onSubmit,
  onCancel,
}: PlanFormDialogProps) {
  const [values, setValues] = useState<PlanFormValues>({
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    dueDate: initial?.due_date ?? "",
  });
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  const titleId = useId();
  const bodyId = useId();
  const nameId = useId();
  const descriptionId = useId();
  const dueDateId = useId();

  const errors: Errors = {};
  const trimmedName = values.name.trim();
  if (!trimmedName) errors.name = "Name is required.";
  else if (trimmedName.length > PLAN_NAME_MAX) {
    errors.name = `Name must be at most ${PLAN_NAME_MAX} characters.`;
  }
  if (values.description.trim().length > PLAN_DESCRIPTION_MAX) {
    errors.description = `Description must be at most ${PLAN_DESCRIPTION_MAX} characters.`;
  }
  if (values.dueDate && !isDateOnly(values.dueDate)) {
    errors.dueDate = "Use a valid date (YYYY-MM-DD).";
  }

  function shown(field: keyof Errors): string | undefined {
    return (
      serverFieldErrors?.[field === "dueDate" ? "due_date" : field] ??
      (submitted || touched.has(field) ? errors[field] : undefined)
    );
  }

  // Focus trap + Escape, mirroring ConfirmDialog.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLInputElement>("input")?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancelRef.current();
        return;
      }
      if (event.key !== "Tab") {
        event.stopPropagation();
        return;
      }
      if (!dialog) return;
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          "input, textarea, button:not(:disabled)"
        )
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
      // Restore focus only when the dialog is really leaving the document: in
      // dev, StrictMode tears this effect down once while the dialog stays on
      // screen, and moving focus back to the trigger then would blur the
      // auto-focused Name field — which marks it touched and flashes "Name is
      // required." before the user has typed anything.
      if (!dialog?.isConnected) previous?.focus();
    };
  }, []);

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    setSubmitted(true);
    if (errors.name || errors.description || errors.dueDate) return;
    onSubmit({
      name: trimmedName,
      description: values.description.trim(),
      dueDate: values.dueDate,
    });
  }

  const title = mode === "edit" ? "Edit plan" : "New plan";

  return (
    <div className="dialog-overlay">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="dialog plan-dialog"
      >
        <form onSubmit={handleSubmit} noValidate>
          <h2 id={titleId}>{title}</h2>
          <p id={bodyId} className="field-hint">
            A plan groups runs for a release or a milestone. Deleting it keeps
            its runs.
          </p>

          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}

          <div className="field">
            <label htmlFor={nameId}>Name</label>
            <input
              id={nameId}
              value={values.name}
              maxLength={PLAN_NAME_MAX}
              disabled={busy}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              onBlur={() =>
                setTouched((current) => new Set(current).add("name"))
              }
              aria-invalid={shown("name") ? true : undefined}
              aria-describedby={shown("name") ? `${nameId}-error` : undefined}
            />
            {shown("name") && (
              <p className="field-error" id={`${nameId}-error`}>
                {shown("name")}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor={descriptionId}>Description</label>
            <textarea
              id={descriptionId}
              rows={3}
              value={values.description}
              disabled={busy}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              onBlur={() =>
                setTouched((current) => new Set(current).add("description"))
              }
              aria-invalid={shown("description") ? true : undefined}
              aria-describedby={
                shown("description")
                  ? `${descriptionId}-error`
                  : `${descriptionId}-hint`
              }
            />
            {shown("description") ? (
              <p className="field-error" id={`${descriptionId}-error`}>
                {shown("description")}
              </p>
            ) : (
              <p className="field-hint" id={`${descriptionId}-hint`}>
                Optional. {PLAN_DESCRIPTION_MAX} characters max.
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor={dueDateId}>Due date</label>
            <input
              id={dueDateId}
              type="date"
              value={values.dueDate}
              disabled={busy}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  dueDate: event.target.value,
                }))
              }
              onBlur={() =>
                setTouched((current) => new Set(current).add("dueDate"))
              }
              aria-invalid={shown("dueDate") ? true : undefined}
              aria-describedby={
                shown("dueDate")
                  ? `${dueDateId}-error`
                  : `${dueDateId}-hint`
              }
            />
            {shown("dueDate") ? (
              <p className="field-error" id={`${dueDateId}-error`}>
                {shown("dueDate")}
              </p>
            ) : (
              <p className="field-hint" id={`${dueDateId}-hint`}>
                Optional. Runs can be due at a different time.
              </p>
            )}
          </div>

          <div className="button-row dialog-actions">
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "Saving…" : mode === "edit" ? "Save plan" : "Create plan"}
            </button>
            <button type="button" disabled={busy} onClick={onCancel}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}