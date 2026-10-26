"use client";

/**
 * SuiteFormDialog — create/rename dialog for the suite tree (card 3.1).
 * Name/description rules mirror docs/api-suites.md § Validation. The parent
 * is fixed by the tree action that opened the dialog ("Add suite" = root,
 * "Add child" = selected suite); moves happen through "Move to…".
 */
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { SuiteNode } from "@/lib/api-types";
import { DisabledHint } from "@/components/ui";

export const SUITE_NAME_MAX = 100;
export const SUITE_DESCRIPTION_MAX = 500;

export interface SuiteFormValues {
  name: string;
  description: string;
}

export interface SuiteFormDialogProps {
  mode: "create" | "edit";
  suite?: SuiteNode | null;
  parentName?: string | null;
  busy?: boolean;
  serverFieldErrors?: { name?: string; description?: string };
  formError?: string | null;
  onSubmit: (values: SuiteFormValues) => void;
  onCancel: () => void;
}

interface Errors {
  name?: string;
  description?: string;
}

export function SuiteFormDialog({
  mode,
  suite = null,
  parentName = null,
  busy = false,
  serverFieldErrors,
  formError,
  onSubmit,
  onCancel,
}: SuiteFormDialogProps) {
  const [values, setValues] = useState<SuiteFormValues>({
    name: suite?.name ?? "",
    description: suite?.description ?? "",
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

  const errors: Errors = {};
  if (!values.name.trim()) errors.name = "Name is required.";
  else if (values.name.trim().length > SUITE_NAME_MAX) {
    errors.name = `Name must be at most ${SUITE_NAME_MAX} characters.`;
  }
  if (values.description.trim().length > SUITE_DESCRIPTION_MAX) {
    errors.description = `Description must be at most ${SUITE_DESCRIPTION_MAX} characters.`;
  }

  function shown(field: keyof Errors): string | undefined {
    return (
      serverFieldErrors?.[field] ??
      (submitted || touched.has(field) ? errors[field] : undefined)
    );
  }

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLInputElement>("input")?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" && event.key !== "Tab") {
        event.stopPropagation();
        return;
      }
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancelRef.current();
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
      previous?.focus();
    };
  }, []);

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    setSubmitted(true);
    if (errors.name || errors.description) return;
    onSubmit({
      name: values.name.trim(),
      description: values.description.trim(),
    });
  }

  return (
    <div className="dialog-overlay">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="dialog suite-dialog"
      >
        <form onSubmit={handleSubmit} noValidate>
          <h2 id={titleId}>
            {mode === "create" ? "New suite" : "Rename suite"}
          </h2>
          <p id={bodyId} className="field-hint">
            {mode === "create"
              ? parentName
                ? `This suite will be a child of ${parentName}.`
                : "Suites group related cases. You can nest up to three levels."
              : "Renaming keeps the suite's cases and child suites in place."}
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
              maxLength={SUITE_NAME_MAX}
              onChange={(event) => {
                setValues((current) => ({
                  ...current,
                  name: event.target.value,
                }));
              }}
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
              onChange={(event) => {
                setValues((current) => ({
                  ...current,
                  description: event.target.value,
                }));
              }}
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
                Optional. 500 characters max.
              </p>
            )}
          </div>

          <div className="button-row dialog-actions">
            <DisabledHint hint={busy ? "Saving — please wait" : null}>
              <button type="submit" className="primary" disabled={busy}>
                {busy
                  ? "Saving…"
                  : mode === "create"
                    ? "Create suite"
                    : "Save name"}
              </button>
            </DisabledHint>
            <DisabledHint hint={busy ? "Can't cancel while saving" : null}>
              <button type="button" disabled={busy} onClick={onCancel}>
                Cancel
              </button>
            </DisabledHint>
          </div>
        </form>
      </div>
    </div>
  );
}
