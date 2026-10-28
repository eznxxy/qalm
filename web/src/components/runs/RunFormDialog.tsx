"use client";

/**
 * RunFormDialog — "New run" (docs/backlog-slice3-plans-runs.md card 3.1,
 * docs/api-runs.md § POST /projects/:projectId/runs).
 *
 * The form collects the run's own fields plus its case selection: one or more
 * whole suites (optionally with descendants) and/or a set of explicit cases,
 * which the API unions and de-duplicates. Field rules mirror the contract:
 * `name` required ≤ 120, `description` ≤ 1,000, `due_date` a plain
 * `YYYY-MM-DD`.
 *
 * The suite picker adds one suite per choice and keeps the chosen ones as
 * removable chips, so the field itself always stays a search box — a run can
 * cover several sibling areas (docs/api-runs.md `selection.suite_ids`).
 *
 * The explicit-case picker searches the project's cases itself (debounced
 * `api.listCases`), the same way CaseEditor talks to the API directly rather
 * than taking a search callback.
 *
 * Modal behaviour (focus trap, Escape, key shield) follows SuiteFormDialog;
 * the suite picker is a `ui/Combobox`, so an open list owns the first Escape
 * (as in MoveDialog).
 */
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type {
  CaseListItem,
  Milestone,
  Plan,
  RunSelection,
  SuiteNode,
} from "@/lib/api-types";
import { api } from "@/lib/endpoints";
import { ApiError } from "@/lib/api-error";
import { isSessionDead } from "@/components/require-auth";
import { isDateOnly } from "@/lib/dates";
import { suiteSearchOptions } from "@/lib/suites";
import { Combobox, DisabledHint } from "@/components/ui";
import "./run-dialog.css";

export const RUN_NAME_MAX = 120;
export const RUN_DESCRIPTION_MAX = 1000;
/** Mirrors `selection.suite_ids` 1–20 in docs/api-runs.md. */
export const RUN_SELECTION_SUITES_MAX = 20;

const CASE_SEARCH_DEBOUNCE_MS = 300;
const CASE_SEARCH_LIMIT = 20;

export interface RunFormValues {
  name: string;
  description: string;
  /** Empty string = no plan. */
  planId: string;
  /** Empty string = no milestone. */
  milestoneId: string;
  /** Empty string = no start date; otherwise `YYYY-MM-DD`. */
  startDate: string;
  /** Empty string = no due date; otherwise `YYYY-MM-DD`. */
  dueDate: string;
}

export interface RunFormDialogProps {
  projectId: string;
  suites: readonly SuiteNode[];
  plans: readonly Plan[];
  /** The project's milestones for the optional Milestone select. */
  milestones?: readonly Milestone[];
  busy?: boolean;
  serverFieldErrors?: {
    name?: string;
    description?: string;
    start_date?: string;
    due_date?: string;
    plan_id?: string;
    milestone_id?: string;
    selection?: string;
  };
  formError?: string | null;
  onSubmit: (values: RunFormValues, selection: RunSelection | undefined) => void;
  onCancel: () => void;
}

interface Errors {
  name?: string;
  description?: string;
  startDate?: string;
  dueDate?: string;
}

/** Form field → the `field` string the API uses in `error.details`. */
type ServerField = keyof NonNullable<RunFormDialogProps["serverFieldErrors"]>;

const SERVER_FIELDS: Record<keyof Errors, ServerField> = {
  name: "name",
  description: "description",
  startDate: "start_date",
  dueDate: "due_date",
};

/** True when the key's target is an expanded combobox (its list is open). */
function isExpandedCombobox(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.getAttribute("role") === "combobox" &&
    target.getAttribute("aria-expanded") === "true"
  );
}

export function RunFormDialog({
  projectId,
  suites,
  plans,
  milestones = [],
  busy = false,
  serverFieldErrors,
  formError,
  onSubmit,
  onCancel,
}: RunFormDialogProps) {
  const [values, setValues] = useState<RunFormValues>({
    name: "",
    description: "",
    planId: "",
    milestoneId: "",
    startDate: "",
    dueDate: "",
  });
  const [suiteIds, setSuiteIds] = useState<string[]>([]);
  const [includeDescendants, setIncludeDescendants] = useState(true);
  const [selectedCases, setSelectedCases] = useState<CaseListItem[]>([]);
  const [caseQuery, setCaseQuery] = useState("");
  const [caseResults, setCaseResults] = useState<CaseListItem[]>([]);
  const [caseSearching, setCaseSearching] = useState(false);
  const [caseError, setCaseError] = useState<string | null>(null);
  /** The needle after the debounce settles; drives the request effect below. */
  const [debouncedCaseQuery, setDebouncedCaseQuery] = useState("");
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
  const planId = useId();
  const milestoneId = useId();
  const startDateId = useId();
  const dueDateId = useId();
  const suiteIdField = useId();
  const descendantsId = useId();
  const caseSearchId = useId();

  const errors: Errors = {};
  const trimmedName = values.name.trim();
  if (!trimmedName) errors.name = "Name is required.";
  else if (trimmedName.length > RUN_NAME_MAX) {
    errors.name = `Name must be at most ${RUN_NAME_MAX} characters.`;
  }
  if (values.description.trim().length > RUN_DESCRIPTION_MAX) {
    errors.description = `Description must be at most ${RUN_DESCRIPTION_MAX} characters.`;
  }
  if (values.startDate && !isDateOnly(values.startDate)) {
    errors.startDate = "Use a valid date (YYYY-MM-DD).";
  }
  if (values.dueDate && !isDateOnly(values.dueDate)) {
    errors.dueDate = "Use a valid date (YYYY-MM-DD).";
  }
  // Both are plain `YYYY-MM-DD`, so a string comparison is a date comparison.
  // The API enforces the same rule (docs/api-runs.md § Validation).
  if (
    values.startDate &&
    values.dueDate &&
    !errors.startDate &&
    !errors.dueDate &&
    values.startDate > values.dueDate
  ) {
    errors.startDate = "Start date must be on or before the due date.";
  }

  function shown(field: keyof Errors): string | undefined {
    return (
      serverFieldErrors?.[SERVER_FIELDS[field]] ??
      (submitted || touched.has(field) ? errors[field] : undefined)
    );
  }

  // Debounce the explicit-case needle: the request effect then fires once the
  // user pauses typing. `setDebouncedCaseQuery` runs from a timer callback, so
  // it never triggers a cascading render from the effect body.
  useEffect(() => {
    const needle = caseQuery.trim();
    const handle = setTimeout(
      () => setDebouncedCaseQuery(needle),
      CASE_SEARCH_DEBOUNCE_MS
    );
    return () => clearTimeout(handle);
  }, [caseQuery]);

  // Search the settled needle; the picker lives inside the dialog, so it starts
  // and stops with it. Clearing the box is handled by the input itself (below),
  // so this effect only ever runs with a needle. The leading await keeps every
  // setState out of the effect's synchronous body (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!debouncedCaseQuery) return;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setCaseSearching(true);
      try {
        const result = await api.listCases(projectId, {
          query: debouncedCaseQuery,
          limit: CASE_SEARCH_LIMIT,
          sort: "case_number",
        });
        if (!active) return;
        setCaseResults(result.data);
        setCaseError(null);
      } catch (err) {
        if (!active || isSessionDead(err)) return;
        setCaseError(
          err instanceof ApiError && err.message
            ? err.message
            : "Could not search cases. Please try again."
        );
      } finally {
        if (active) setCaseSearching(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [debouncedCaseQuery, projectId]);

  // Focus trap + Escape, mirroring SuiteFormDialog. An open suite picker keeps
  // the first Escape for itself.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLInputElement>("input")?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (isExpandedCombobox(event.target)) return;
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
          "input, select, textarea, button:not(:disabled)"
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

  const suiteOptions = suiteSearchOptions(suites).map((option) => ({
    id: option.id,
    label: option.label,
    depth: option.depth,
    path: option.path,
  }));
  const suiteLabelById = new Map(
    suiteOptions.map((option) => [option.id, option.label])
  );
  // Chosen suites leave the list, so the same suite cannot be added twice.
  const addableSuites = suiteOptions.filter(
    (option) => !suiteIds.includes(option.id)
  );
  const suiteCapReached = suiteIds.length >= RUN_SELECTION_SUITES_MAX;

  function addSuite(id: string): void {
    setSuiteIds((current) =>
      current.includes(id) || current.length >= RUN_SELECTION_SUITES_MAX
        ? current
        : [...current, id]
    );
  }

  function removeSuite(id: string): void {
    setSuiteIds((current) => current.filter((suite) => suite !== id));
  }

  function addCase(row: CaseListItem): void {
    setSelectedCases((current) =>
      current.some((item) => item.id === row.id) ? current : [...current, row]
    );
  }

  function removeCase(id: string): void {
    setSelectedCases((current) => current.filter((item) => item.id !== id));
  }

  function buildSelection(): RunSelection | undefined {
    const selection: RunSelection = {};
    if (selectedCases.length > 0) {
      selection.case_ids = selectedCases.map((item) => item.id);
    }
    if (suiteIds.length > 0) {
      selection.suite_ids = [...suiteIds];
      selection.include_descendants = includeDescendants;
    }
    return selection.case_ids || selection.suite_ids ? selection : undefined;
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length > 0) return;
    onSubmit(
      {
        name: trimmedName,
        description: values.description.trim(),
        planId: values.planId,
        milestoneId: values.milestoneId,
        startDate: values.startDate,
        dueDate: values.dueDate,
      },
      buildSelection()
    );
  }

  return (
    <div className="dialog-overlay">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="dialog run-dialog"
      >
        <form onSubmit={handleSubmit} noValidate>
          <h2 id={titleId}>New run</h2>
          <p id={bodyId} className="field-hint">
            A run snapshots the cases you pick so results stay readable even if
            the cases change later.
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
              maxLength={RUN_NAME_MAX}
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
                Optional. {RUN_DESCRIPTION_MAX} characters max.
              </p>
            )}
          </div>

          <div className="run-dialog-row">
            <div className="field">
              <label htmlFor={planId}>Plan</label>
              <select
                id={planId}
                value={values.planId}
                disabled={busy}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    planId: event.target.value,
                  }))
                }
                aria-invalid={serverFieldErrors?.plan_id ? true : undefined}
              >
                <option value="">No plan</option>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor={milestoneId}>Milestone</label>
              <select
                id={milestoneId}
                value={values.milestoneId}
                disabled={busy}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    milestoneId: event.target.value,
                  }))
                }
                aria-invalid={
                  serverFieldErrors?.milestone_id ? true : undefined
                }
                aria-describedby={
                  serverFieldErrors?.milestone_id
                    ? `${milestoneId}-error`
                    : `${milestoneId}-hint`
                }
              >
                <option value="">No milestone</option>
                {milestones.map((milestone) => (
                  <option key={milestone.id} value={milestone.id}>
                    {milestone.name}
                  </option>
                ))}
              </select>
              {serverFieldErrors?.milestone_id ? (
                <p className="field-error" id={`${milestoneId}-error`}>
                  {serverFieldErrors.milestone_id}
                </p>
              ) : (
                <p className="field-hint" id={`${milestoneId}-hint`}>
                  Optional. A run can belong to one milestone.
                </p>
              )}
            </div>
          </div>

          <div className="run-dialog-row">
            <div className="field">
              <label htmlFor={startDateId}>Start date</label>
              <input
                id={startDateId}
                type="date"
                value={values.startDate}
                disabled={busy}
                max={values.dueDate || undefined}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    startDate: event.target.value,
                  }))
                }
                aria-invalid={shown("startDate") ? true : undefined}
                aria-describedby={
                  shown("startDate") ? `${startDateId}-error` : undefined
                }
              />
              {shown("startDate") && (
                <p className="field-error" id={`${startDateId}-error`}>
                  {shown("startDate")}
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
                min={values.startDate || undefined}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    dueDate: event.target.value,
                  }))
                }
                aria-invalid={shown("dueDate") ? true : undefined}
                aria-describedby={
                  shown("dueDate") ? `${dueDateId}-error` : undefined
                }
              />
              {shown("dueDate") && (
                <p className="field-error" id={`${dueDateId}-error`}>
                  {shown("dueDate")}
                </p>
              )}
            </div>
          </div>

          <fieldset className="fieldset">
            <legend>Cases</legend>

            <div className="field">
              <label htmlFor={suiteIdField}>Whole suites</label>
              <Combobox
                id={suiteIdField}
                value=""
                options={addableSuites}
                onChange={addSuite}
                placeholder="Add a suite…"
                emptyMessage={
                  addableSuites.length === 0
                    ? "Every suite is already selected."
                    : "No suites match."
                }
                disabled={busy || suiteCapReached}
                openOnFocus={false}
              />
              {suiteIds.length > 0 && (
                <ul className="run-suite-chips" aria-label="Selected suites">
                  {suiteIds.map((id) => {
                    const label = suiteLabelById.get(id) ?? id;
                    return (
                      <li key={id}>
                        <span>{label}</span>
                        <button
                          type="button"
                          className="run-case-remove"
                          aria-label={`Remove suite ${label}`}
                          title="Remove"
                          disabled={busy}
                          onClick={() => removeSuite(id)}
                        >
                          <span aria-hidden="true">×</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="field-hint">
                {suiteCapReached
                  ? `Up to ${RUN_SELECTION_SUITES_MAX} suites per run.`
                  : "Each suite adds every live case inside it (and its descendants, unless you turn that off). Optional."}
              </p>
            </div>

            <div className="field field-checkbox">
              <input
                id={descendantsId}
                type="checkbox"
                checked={includeDescendants}
                disabled={busy || suiteIds.length === 0}
                onChange={(event) => setIncludeDescendants(event.target.checked)}
              />
              <label htmlFor={descendantsId}>Include descendants</label>
            </div>

            <div className="field">
              <label htmlFor={caseSearchId}>Add specific cases</label>
              <input
                id={caseSearchId}
                type="search"
                value={caseQuery}
                placeholder="Search cases by title"
                disabled={busy}
                onChange={(event) => {
                  const value = event.target.value;
                  setCaseQuery(value);
                  // Clearing the box drops the results right away — no need to
                  // wait for the debounce to settle on an empty needle.
                  if (!value.trim()) {
                    setCaseResults([]);
                    setCaseSearching(false);
                    setCaseError(null);
                  }
                }}
              />
              {caseError && (
                <p className="field-error" role="alert">
                  {caseError}
                </p>
              )}
              {caseSearching && (
                <p className="field-hint" role="status">
                  Searching…
                </p>
              )}
              {caseResults.length > 0 && (
                <ul className="run-case-results">
                  {caseResults.map((row) => {
                    const already = selectedCases.some(
                      (item) => item.id === row.id
                    );
                    return (
                      <li key={row.id}>
                        <button
                          type="button"
                          className="run-case-add"
                          disabled={busy || already}
                          onClick={() => addCase(row)}
                        >
                          <code>{row.display_id}</code> {row.title}
                        </button>
                        {already && <span className="muted">Added</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
              {selectedCases.length > 0 && (
                <ul className="run-case-chips" aria-label="Selected cases">
                  {selectedCases.map((row) => (
                    <li key={row.id}>
                      <span>
                        <code>{row.display_id}</code> {row.title}
                      </span>
                      <button
                        type="button"
                        className="run-case-remove"
                        aria-label={`Remove ${row.display_id}`}
                        title="Remove"
                        disabled={busy}
                        onClick={() => removeCase(row.id)}
                      >
                        <span aria-hidden="true">×</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {serverFieldErrors?.selection && (
                <p className="field-error">{serverFieldErrors.selection}</p>
              )}
            </div>
          </fieldset>

          <div className="button-row dialog-actions">
            <DisabledHint hint={busy ? "Creating — please wait" : null}>
              <button type="submit" className="primary" disabled={busy}>
                {busy ? "Creating…" : "Create run"}
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