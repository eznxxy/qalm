"use client";

/**
 * PlanWithRunsDialog — "New plan" on the runs screen (backlog card 3.6).
 *
 * A plan with no runs is a folder with nothing in it, so this dialog collects
 * both halves and posts them as one request (docs/api-plans.md § POST
 * /projects/:projectId/plans): the plan's own three fields plus one fieldset
 * per run. The API inserts the plan and its runs in one transaction, so a
 * rejected run leaves no plan behind — and Save is blocked below one run,
 * mirroring the contract's "at least one run, at most 20" rule.
 *
 * The embedded runs are name/description/dates only. Picking cases belongs to
 * the New run dialog (and a plan made this way starts with its runs empty, by
 * design — see the contract's note on `runs`).
 *
 * Field rules are the same constants the other two dialogs use: plan name
 * required 1–120, descriptions ≤ 1,000, dates plain `YYYY-MM-DD` with start ≤
 * due. Two runs in this dialog may not share a name (case-insensitive) — caught
 * here so the form cannot send a request that would 409; a clash with a run
 * that already exists in the project is server-side, so errors arrive keyed
 * exactly like the API's `details[].field` — including the indexed
 * `runs[0].name` form.
 *
 * Modal behaviour (focus trap, Escape, key shield) mirrors PlanFormDialog.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { isDateOnly } from "@/lib/dates";
import {
  PLAN_DESCRIPTION_MAX,
  PLAN_NAME_MAX,
} from "@/components/plans/PlanFormDialog";
import {
  RUN_DESCRIPTION_MAX,
  RUN_NAME_MAX,
} from "@/components/runs/RunFormDialog";
import { DisabledHint } from "@/components/ui";
import "./plan-with-runs-dialog.css";

/** Contract cap on `runs` for one create (docs/api-plans.md § Validation). */
export const PLAN_RUNS_MAX = 20;

export interface PlanRunValues {
  name: string;
  description: string;
  /** Empty string = no start date; otherwise `YYYY-MM-DD`. */
  startDate: string;
  /** Empty string = no due date; otherwise `YYYY-MM-DD`. */
  dueDate: string;
}

export interface PlanWithRunsValues {
  name: string;
  description: string;
  /** Empty string = no due date; otherwise `YYYY-MM-DD`. */
  dueDate: string;
  runs: PlanRunValues[];
}

export interface PlanWithRunsDialogProps {
  busy?: boolean;
  /**
   * API error details keyed by the server's `field` string: `name`,
   * `description`, `due_date`, `runs`, or an indexed run field such as
   * `runs[1].name`.
   */
  serverFieldErrors?: Readonly<Record<string, string>>;
  formError?: string | null;
  onSubmit: (values: PlanWithRunsValues) => void;
  onCancel: () => void;
}

/** A draft run plus a stable React key (array index shifts after a removal). */
interface RunDraft extends PlanRunValues {
  key: number;
}

function emptyRun(key: number): RunDraft {
  return { key, name: "", description: "", startDate: "", dueDate: "" };
}

/** Local validation keys: plan fields by name, run fields as `0.name`. */
type LocalErrors = Record<string, string>;

export function PlanWithRunsDialog({
  busy = false,
  serverFieldErrors,
  formError,
  onSubmit,
  onCancel,
}: PlanWithRunsDialogProps) {
  const nextKey = useRef(2);
  const [runs, setRuns] = useState<RunDraft[]>([emptyRun(1)]);
  const [values, setValues] = useState({
    name: "",
    description: "",
    dueDate: "",
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
  const runFieldId = useId();

  // ---- validation ----
  const localErrors: LocalErrors = {};
  const trimmedName = values.name.trim();
  if (!trimmedName) localErrors.name = "Plan name is required.";
  else if (trimmedName.length > PLAN_NAME_MAX) {
    localErrors.name = `Plan name must be at most ${PLAN_NAME_MAX} characters.`;
  }
  if (values.description.trim().length > PLAN_DESCRIPTION_MAX) {
    localErrors.description = `Description must be at most ${PLAN_DESCRIPTION_MAX} characters.`;
  }
  if (values.dueDate && !isDateOnly(values.dueDate)) {
    localErrors.dueDate = "Use a valid date (YYYY-MM-DD).";
  }

  const seenRunNames = new Map<string, number>();
  for (const [index, run] of runs.entries()) {
    const runName = run.name.trim();
    if (!runName) localErrors[`${index}.name`] = "Run name is required.";
    else if (runName.length > RUN_NAME_MAX) {
      localErrors[`${index}.name`] =
        `Run name must be at most ${RUN_NAME_MAX} characters.`;
    } else {
      // One live run per name in the project (docs/api-runs.md § Validation),
      // so a repeat inside this dialog can never succeed. The first run keeps
      // the name; the later ones carry the error.
      const key = runName.toLowerCase();
      const first = seenRunNames.get(key);
      if (first === undefined) seenRunNames.set(key, index);
      else {
        localErrors[`${index}.name`] =
          `Run name is already used by Run ${first + 1}.`;
      }
    }
    if (run.description.trim().length > RUN_DESCRIPTION_MAX) {
      localErrors[`${index}.description`] =
        `Description must be at most ${RUN_DESCRIPTION_MAX} characters.`;
    }
    if (run.startDate && !isDateOnly(run.startDate)) {
      localErrors[`${index}.startDate`] = "Use a valid date (YYYY-MM-DD).";
    }
    if (run.dueDate && !isDateOnly(run.dueDate)) {
      localErrors[`${index}.dueDate`] = "Use a valid date (YYYY-MM-DD).";
    }
    // Both are plain `YYYY-MM-DD`, so a string comparison is a date comparison.
    // The API enforces the same rule (docs/api-runs.md § Validation).
    if (
      run.startDate &&
      run.dueDate &&
      !localErrors[`${index}.startDate`] &&
      !localErrors[`${index}.dueDate`] &&
      run.startDate > run.dueDate
    ) {
      localErrors[`${index}.startDate`] =
        "Start date must be on or before the due date.";
    }
  }

  /** Server error for `field`, else the local one once it has been earned. */
  function errorFor(field: string, localKey = field): string | undefined {
    const server = serverFieldErrors?.[field];
    if (server) return server;
    return submitted || touched.has(localKey) ? localErrors[localKey] : undefined;
  }

  // Focus trap + Escape, mirroring PlanFormDialog.
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
      // auto-focused Plan name field — which marks it touched and flashes
      // "Plan name is required." before the user has typed anything.
      if (!dialog?.isConnected) previous?.focus();
    };
  }, []);

  function markTouched(key: string): void {
    setTouched((current) => new Set(current).add(key));
  }

  function setRun(index: number, patch: Partial<PlanRunValues>): void {
    setRuns((current) =>
      current.map((run, i) => (i === index ? { ...run, ...patch } : run))
    );
  }

  function addRun(): void {
    setRuns((current) =>
      current.length >= PLAN_RUNS_MAX
        ? current
        : [...current, emptyRun(nextKey.current++)]
    );
  }

  function removeRun(index: number): void {
    setRuns((current) => current.filter((_, i) => i !== index));
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    setSubmitted(true);
    // Save is disabled at zero runs; the guard keeps the option open if the
    // list is ever changed to allow removing the last row.
    if (runs.length === 0) return;
    if (Object.keys(localErrors).length > 0) return;
    onSubmit({
      name: trimmedName,
      description: values.description.trim(),
      dueDate: values.dueDate,
      runs: runs.map((run) => ({
        name: run.name.trim(),
        description: run.description.trim(),
        startDate: run.startDate,
        dueDate: run.dueDate,
      })),
    });
  }

  const atMaxRuns = runs.length >= PLAN_RUNS_MAX;
  const zeroRuns = runs.length === 0;

  return (
    <div className="dialog-overlay">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="dialog plan-with-runs-dialog"
      >
        <form onSubmit={handleSubmit} noValidate>
          <h2 id={titleId}>New plan</h2>
          <p id={bodyId} className="field-hint">
            A plan groups runs for a release or a milestone. The plan and the
            runs below are created together.
          </p>

          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}

          <div className="field">
            <label htmlFor={nameId}>Plan name</label>
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
              onBlur={() => markTouched("name")}
              aria-invalid={errorFor("name") ? true : undefined}
              aria-describedby={errorFor("name") ? `${nameId}-error` : undefined}
            />
            {errorFor("name") && (
              <p className="field-error" id={`${nameId}-error`}>
                {errorFor("name")}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor={descriptionId}>Plan description</label>
            <textarea
              id={descriptionId}
              rows={2}
              value={values.description}
              disabled={busy}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              onBlur={() => markTouched("description")}
              aria-invalid={errorFor("description") ? true : undefined}
              aria-describedby={
                errorFor("description")
                  ? `${descriptionId}-error`
                  : `${descriptionId}-hint`
              }
            />
            {errorFor("description") ? (
              <p className="field-error" id={`${descriptionId}-error`}>
                {errorFor("description")}
              </p>
            ) : (
              <p className="field-hint" id={`${descriptionId}-hint`}>
                Optional. {PLAN_DESCRIPTION_MAX} characters max.
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor={dueDateId}>Plan due date</label>
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
              onBlur={() => markTouched("dueDate")}
              aria-invalid={errorFor("due_date", "dueDate") ? true : undefined}
              aria-describedby={
                errorFor("due_date", "dueDate")
                  ? `${dueDateId}-error`
                  : `${dueDateId}-hint`
              }
            />
            {errorFor("due_date", "dueDate") ? (
              <p className="field-error" id={`${dueDateId}-error`}>
                {errorFor("due_date", "dueDate")}
              </p>
            ) : (
              <p className="field-hint" id={`${dueDateId}-hint`}>
                Optional. Runs can be due at a different time.
              </p>
            )}
          </div>

          <fieldset className="fieldset pwr-runs">
            <legend>Runs</legend>
            <p className="field-hint pwr-runs-hint">
              At least one run is required, and a plan can hold {PLAN_RUNS_MAX}.
              Names and dates only — pick the cases later on the run.
            </p>

            {serverFieldErrors?.runs && (
              <p className="field-error" role="alert">
                {serverFieldErrors.runs}
              </p>
            )}

            {zeroRuns && (
              <p className="pwr-runs-empty">
                A plan needs at least one run before it can be saved.
              </p>
            )}

            <div className="pwr-run-list">
              {runs.map((run, index) => {
                const nameKey = `${index}.name`;
                const descriptionKey = `${index}.description`;
                const startKey = `${index}.startDate`;
                const dueKey = `${index}.dueDate`;
                const runNameId = `${runFieldId}-${run.key}-name`;
                const runDescriptionId = `${runFieldId}-${run.key}-description`;
                const runStartId = `${runFieldId}-${run.key}-start`;
                const runDueId = `${runFieldId}-${run.key}-due`;
                return (
                  <fieldset className="pwr-run" key={run.key}>
                    <legend>Run {index + 1}</legend>
                    <button
                      type="button"
                      className="pwr-run-remove"
                      aria-label={`Remove run ${index + 1}`}
                      disabled={busy}
                      onClick={() => removeRun(index)}
                    >
                      Remove
                    </button>

                    <div className="pwr-run-grid">
                      <div className="field pwr-wide">
                        <label htmlFor={runNameId}>Name</label>
                        <input
                          id={runNameId}
                          value={run.name}
                          maxLength={RUN_NAME_MAX}
                          disabled={busy}
                          onChange={(event) =>
                            setRun(index, { name: event.target.value })
                          }
                          onBlur={() => markTouched(nameKey)}
                          aria-invalid={
                            errorFor(`runs[${index}].name`, nameKey)
                              ? true
                              : undefined
                          }
                          aria-describedby={
                            errorFor(`runs[${index}].name`, nameKey)
                              ? `${runNameId}-error`
                              : undefined
                          }
                        />
                        {errorFor(`runs[${index}].name`, nameKey) && (
                          <p className="field-error" id={`${runNameId}-error`}>
                            {errorFor(`runs[${index}].name`, nameKey)}
                          </p>
                        )}
                      </div>

                      <div className="field">
                        <label htmlFor={runStartId}>Start date</label>
                        <input
                          id={runStartId}
                          type="date"
                          value={run.startDate}
                          disabled={busy}
                          max={run.dueDate || undefined}
                          onChange={(event) =>
                            setRun(index, { startDate: event.target.value })
                          }
                          onBlur={() => markTouched(startKey)}
                          aria-invalid={
                            errorFor(`runs[${index}].start_date`, startKey)
                              ? true
                              : undefined
                          }
                          aria-describedby={
                            errorFor(`runs[${index}].start_date`, startKey)
                              ? `${runStartId}-error`
                              : undefined
                          }
                        />
                        {errorFor(`runs[${index}].start_date`, startKey) && (
                          <p className="field-error" id={`${runStartId}-error`}>
                            {errorFor(`runs[${index}].start_date`, startKey)}
                          </p>
                        )}
                      </div>

                      <div className="field">
                        <label htmlFor={runDueId}>Due date</label>
                        <input
                          id={runDueId}
                          type="date"
                          value={run.dueDate}
                          disabled={busy}
                          min={run.startDate || undefined}
                          onChange={(event) =>
                            setRun(index, { dueDate: event.target.value })
                          }
                          onBlur={() => markTouched(dueKey)}
                          aria-invalid={
                            errorFor(`runs[${index}].due_date`, dueKey)
                              ? true
                              : undefined
                          }
                          aria-describedby={
                            errorFor(`runs[${index}].due_date`, dueKey)
                              ? `${runDueId}-error`
                              : undefined
                          }
                        />
                        {errorFor(`runs[${index}].due_date`, dueKey) && (
                          <p className="field-error" id={`${runDueId}-error`}>
                            {errorFor(`runs[${index}].due_date`, dueKey)}
                          </p>
                        )}
                      </div>

                      <div className="field pwr-wide">
                        <label htmlFor={runDescriptionId}>Description</label>
                        <textarea
                          id={runDescriptionId}
                          rows={2}
                          value={run.description}
                          disabled={busy}
                          onChange={(event) =>
                            setRun(index, { description: event.target.value })
                          }
                          onBlur={() => markTouched(descriptionKey)}
                          aria-invalid={
                            errorFor(
                              `runs[${index}].description`,
                              descriptionKey
                            )
                              ? true
                              : undefined
                          }
                          aria-describedby={
                            errorFor(
                              `runs[${index}].description`,
                              descriptionKey
                            )
                              ? `${runDescriptionId}-error`
                              : undefined
                          }
                        />
                        {errorFor(`runs[${index}].description`, descriptionKey) && (
                          <p
                            className="field-error"
                            id={`${runDescriptionId}-error`}
                          >
                            {errorFor(
                              `runs[${index}].description`,
                              descriptionKey
                            )}
                          </p>
                        )}
                      </div>
                    </div>
                  </fieldset>
                );
              })}
            </div>

            <div className="pwr-add">
              <DisabledHint
                hint={
                  atMaxRuns
                    ? `A plan can hold at most ${PLAN_RUNS_MAX} runs`
                    : null
                }
              >
                <button
                  type="button"
                  disabled={busy || atMaxRuns}
                  onClick={addRun}
                >
                  Add run
                </button>
              </DisabledHint>
              <span className="field-hint" aria-live="polite">
                {runs.length} of {PLAN_RUNS_MAX} runs
              </span>
            </div>
          </fieldset>

          <div className="button-row dialog-actions">
            <DisabledHint
              hint={
                zeroRuns
                  ? "Add at least one run to save the plan"
                  : busy
                    ? "Creating — please wait"
                    : null
              }
            >
              <button
                type="submit"
                className="primary"
                disabled={busy || zeroRuns}
              >
                {busy ? "Creating…" : "Create plan"}
              </button>
            </DisabledHint>
            <DisabledHint hint={busy ? "Can't cancel while creating" : null}>
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