"use client";

/**
 * PlanWithRunsDialog — "New plan" on the runs screen (backlog card 3.6).
 *
 * A plan with no runs is a folder with nothing in it, so this dialog collects
 * both halves and posts them as one request (docs/api-plans.md § POST
 * /projects/:projectId/plans): the plan's own three fields plus one fieldset
 * per new run, and — since card 3.10 — any existing runs that have no plan yet.
 * The API inserts the plan, its runs and the attachments in one transaction, so
 * a rejected run leaves no plan behind — and Save is blocked below one run
 * overall, mirroring the contract's "at least one run, at most 20" rule.
 *
 * The embedded runs are name/description/dates only. Picking cases belongs to
 * the New run dialog (and a plan made this way starts with its runs empty, by
 * design — see the contract's note on `runs`).
 *
 * Existing runs: only the ones the page fetched with `plan_id=none` are
 * offered, because attaching must never move a run out of another plan (the
 * API refuses those too). Ticking one adds a read-only row — the run keeps its
 * own fields, items and results — and the 20-run cap counts new and attached
 * runs together.
 *
 * Field rules are the same constants the other two dialogs use: plan name
 * required 1–120, descriptions ≤ 1,000, dates plain `YYYY-MM-DD` with start ≤
 * due. Two runs in this dialog may not share a name (case-insensitive) — caught
 * here so the form cannot send a request that would 409; a clash with a run
 * that already exists in the project is server-side, so errors arrive keyed
 * exactly like the API's `details[].field` — including the indexed
 * `runs[0].name` and `run_ids[0]` forms.
 *
 * Modal behaviour (focus trap, Escape, key shield) mirrors PlanFormDialog.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { isDateOnly } from "@/lib/dates";
import { RUN_STATUS_LABELS, type Run } from "@/lib/api-types";
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
  /** Ids of existing unplanned runs to attach, in the order shown. */
  runIds: string[];
}

export interface PlanWithRunsDialogProps {
  busy?: boolean;
  /**
   * Live runs of this project that have no plan, already fetched with
   * `plan_id=none`. Empty while loading or when there are none.
   */
  unplannedRuns?: readonly Run[];
  unplannedRunsLoading?: boolean;
  unplannedRunsError?: string | null;
  /** The picker's "Try again": the page refetches the unplanned runs. */
  onRetryUnplannedRuns?: () => void;
  /**
   * API error details keyed by the server's `field` string: `name`,
   * `description`, `due_date`, `runs`, `run_ids`, or an indexed run field such
   * as `runs[1].name` / `run_ids[0]`.
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

/**
 * A run row the user has not filled in at all. It is a placeholder, not a run:
 * once an existing run is attached it must not block Save with "Run name is
 * required", and nothing is sent for it.
 */
function hasRunContent(run: PlanRunValues): boolean {
  return Boolean(
    run.name.trim() ||
      run.description.trim() ||
      run.startDate ||
      run.dueDate
  );
}

/** Local validation keys: plan fields by name, run fields as `0.name`. */
type LocalErrors = Record<string, string>;

export function PlanWithRunsDialog({
  busy = false,
  unplannedRuns,
  unplannedRunsLoading = false,
  unplannedRunsError = null,
  onRetryUnplannedRuns,
  serverFieldErrors,
  formError,
  onSubmit,
  onCancel,
}: PlanWithRunsDialogProps) {
  const nextKey = useRef(2);
  const [runs, setRuns] = useState<RunDraft[]>([emptyRun(1)]);
  /** Attached existing runs, in the order the user ticked them. */
  const [attachedIds, setAttachedIds] = useState<string[]>([]);
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

  // ---- existing runs to attach (docs/api-plans.md § Attaching existing runs) ----
  const unplannedById = new Map((unplannedRuns ?? []).map((run) => [run.id, run]));
  // Keep the tick order; a run that vanished from the page's list still has an
  // id to send, so only drop rows we cannot label.
  const attachedRuns = attachedIds.flatMap((id) => {
    const run = unplannedById.get(id);
    return run ? [run] : [];
  });
  const availableRuns = (unplannedRuns ?? []).filter(
    (run) => !attachedIds.includes(run.id)
  );
  const totalRuns = runs.length + attachedRuns.length;
  // An untouched new-run row is a placeholder once there is something else to
  // save: attaching a run says the plan's runs are already known, so the empty
  // row neither blocks Save nor goes up. Rows are added after the empty starter
  // row is dropped in `attachRun`, so the rows that are sent stay a prefix of
  // the list and index-based error keys still line up with the request body.
  const submittedRuns =
    attachedRuns.length > 0 ? runs.filter(hasRunContent) : runs;
  const submittedKeys = new Set(submittedRuns.map((run) => run.key));
  const atMaxRuns = totalRuns >= PLAN_RUNS_MAX;
  const zeroRuns = totalRuns === 0;

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
    // Placeholder rows (an empty "New runs" row next to attached runs) are
    // not part of the request, so they are not validated either.
    if (!submittedKeys.has(run.key)) continue;
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

  /**
   * Server error for `field`, else the local one once it has been earned.
   */
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
    if (totalRuns >= PLAN_RUNS_MAX) return;
    setRuns((current) => [...current, emptyRun(nextKey.current++)]);
  }

  function removeRun(index: number): void {
    setRuns((current) => current.filter((_, i) => i !== index));
  }

  function attachRun(id: string): void {
    if (totalRuns >= PLAN_RUNS_MAX || attachedIds.includes(id)) return;
    setAttachedIds((current) => [...current, id]);
    // The default empty run row is a placeholder — adopting an existing run
    // answers "which runs does this plan have". A row with anything typed in
    // it stays, because that is a run the user has started to describe.
    setRuns((current) => current.filter(hasRunContent));
  }

  function detachRun(id: string): void {
    setAttachedIds((current) => current.filter((runId) => runId !== id));
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    setSubmitted(true);
    // Save is disabled at zero runs; the guard keeps the option open if the
    // list is ever changed to allow removing the last row.
    if (totalRuns === 0) return;
    if (Object.keys(localErrors).length > 0) return;
    onSubmit({
      name: trimmedName,
      description: values.description.trim(),
      dueDate: values.dueDate,
      runs: submittedRuns.map((run) => ({
        name: run.name.trim(),
        description: run.description.trim(),
        startDate: run.startDate,
        dueDate: run.dueDate,
      })),
      // Only the rows on screen are sent, so a `run_ids[i]` error always names
      // the row the user can see; a run that vanished from the page's list mid-
      // edit simply drops out instead of failing the save.
      runIds: attachedRuns.map((run) => run.id),
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
        className="dialog plan-with-runs-dialog"
      >
        <form onSubmit={handleSubmit} noValidate>
          <h2 id={titleId}>New plan</h2>
          <p id={bodyId} className="field-hint">
            A plan groups runs for a release or a milestone. The plan and the
            new runs below are created together; existing runs can be attached
            too.
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
            <legend>New runs</legend>
            <p className="field-hint pwr-runs-hint">
              A plan needs at least one run in total (new or attached) and can
              hold {PLAN_RUNS_MAX}. Names and dates only — pick the cases later
              on the run.
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
                    ? `A plan can hold at most ${PLAN_RUNS_MAX} runs, including attached ones`
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
                {`${runs.length} new · ${attachedRuns.length} attached · ${totalRuns} of ${PLAN_RUNS_MAX} runs`}
              </span>
            </div>
          </fieldset>

          <fieldset className="fieldset pwr-attach">
            <legend>Attach existing runs</legend>
            <p className="field-hint">
              Only runs that have no plan are listed. An attached run keeps its
              name, dates, cases and results.
            </p>

            {serverFieldErrors?.run_ids && (
              <p className="field-error" role="alert">
                {serverFieldErrors.run_ids}
              </p>
            )}

            {attachedRuns.length > 0 && (
              <ul className="pwr-attached-list">
                {attachedRuns.map((run, index) => {
                  const serverError = serverFieldErrors?.[`run_ids[${index}]`];
                  return (
                    <li className="pwr-attached" key={run.id}>
                      <div className="pwr-attached-body">
                        <span className="pwr-attached-name">
                          {run.name}
                        </span>
                        <span className="field-hint">
                          {RUN_STATUS_LABELS[run.status]} ·{" "}
                          {run.counts.percent_complete}% complete · Attached to
                          this plan; its fields stay as they are.
                        </span>
                        {serverError && (
                          <p
                            className="field-error"
                            id={`${runFieldId}-${run.id}-error`}
                            role="alert"
                          >
                            {serverError}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        aria-label={`Remove ${run.name}`}
                        disabled={busy}
                        onClick={() => detachRun(run.id)}
                      >
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {unplannedRunsLoading && (
              <p className="field-hint" role="status">
                Loading runs…
              </p>
            )}

            {!unplannedRunsLoading && unplannedRunsError && (
              <p className="field-error" role="alert">
                {unplannedRunsError}
                {onRetryUnplannedRuns && (
                  <>
                    {" "}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={onRetryUnplannedRuns}
                    >
                      Try again
                    </button>
                  </>
                )}
              </p>
            )}

            {!unplannedRunsLoading &&
              !unplannedRunsError &&
              availableRuns.length === 0 && (
                <p className="pwr-runs-empty">
                  {attachedRuns.length > 0
                    ? "Every unplanned run is attached."
                    : "No unplanned runs in this project — add one above."}
                </p>
              )}

            {availableRuns.length > 0 && (
              <ul className="pwr-pick-list">
                {availableRuns.map((run) => (
                  <li className="pwr-pick" key={run.id}>
                    <div className="pwr-pick-body">
                      <span className="pwr-pick-name">{run.name}</span>
                      <span className="field-hint">
                        {RUN_STATUS_LABELS[run.status]} ·{" "}
                        {run.counts.percent_complete}% complete
                        {run.start_date || run.due_date
                          ? ` · ${run.start_date ?? "no start"} → ${run.due_date ?? "no due date"}`
                          : ""}
                      </span>
                    </div>
                    <DisabledHint
                      hint={
                        atMaxRuns
                          ? `A plan can hold at most ${PLAN_RUNS_MAX} runs`
                          : null
                      }
                    >
                      <button
                        type="button"
                        aria-label={`Attach ${run.name}`}
                        disabled={busy || atMaxRuns}
                        onClick={() => attachRun(run.id)}
                      >
                        Attach
                      </button>
                    </DisabledHint>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>

          <div className="button-row dialog-actions">
            <DisabledHint
              hint={
                zeroRuns
                  ? "Add or attach at least one run to save the plan"
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