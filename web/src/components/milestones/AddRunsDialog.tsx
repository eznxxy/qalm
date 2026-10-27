"use client";

/**
 * AddRunsDialog — "Add runs" on a milestone's detail screen (docs/DESIGN.md
 * §4.5, docs/api-milestones.md § POST /milestones/:id/runs).
 *
 * The page fetches `milestone_id=none`, so the list can only offer live runs of
 * the project that have no milestone: attaching never moves a run out of another
 * one (the API refuses that too, naming `run_ids[i]`). Each row carries the run's
 * status and progress, because the tick is a decision about work already done.
 *
 * Ticking is local until Save; the request sends exactly the ticked ids in the
 * order shown, so a server error keyed `run_ids[i]` names a row on screen.
 *
 * Modal behaviour (focus trap, Escape, key shield) mirrors PlanFormDialog.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { RUN_STATUS_LABELS, type Run } from "@/lib/api-types";
import { formatDateOnly } from "@/lib/dates";
import "./add-runs-dialog.css";

export interface AddRunsDialogProps {
  /** Candidate runs: live, of this project, with no milestone. */
  runs: readonly Run[];
  loading?: boolean;
  /** The picker's load error; the page owns the retry. */
  error?: string | null;
  onRetry?: () => void;
  busy?: boolean;
  /**
   * API error details keyed by the server's `field` — `run_ids` for the list or
   * `run_ids[i]` for one row.
   */
  serverFieldErrors?: Readonly<Record<string, string>>;
  formError?: string | null;
  onSubmit: (runIds: string[]) => void;
  onCancel: () => void;
}

export function AddRunsDialog({
  runs,
  loading = false,
  error = null,
  onRetry,
  busy = false,
  serverFieldErrors,
  formError,
  onSubmit,
  onCancel,
}: AddRunsDialogProps) {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());

  const dialogRef = useRef<HTMLDivElement>(null);
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  const titleId = useId();
  const bodyId = useId();
  const listId = useId();

  // List order, so `run_ids[i]` lines up with what is on screen.
  const selectedRuns = runs.filter((run) => selectedIds.has(run.id));

  function toggle(id: string): void {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Focus trap + Escape, mirroring PlanFormDialog.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog
      ?.querySelector<HTMLInputElement>("input[type='checkbox']")
      ?.focus();

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
          "input, button:not(:disabled)"
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
      // Restore focus only when the dialog really leaves the document: in dev,
      // StrictMode tears the effect down once while the dialog stays on screen.
      if (!dialog?.isConnected) previous?.focus();
    };
  }, []);

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (selectedRuns.length === 0) return;
    onSubmit(selectedRuns.map((run) => run.id));
  }

  const count = selectedRuns.length;

  return (
    <div className="dialog-overlay">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="dialog add-runs-dialog"
      >
        <form onSubmit={handleSubmit} noValidate>
          <h2 id={titleId}>Add runs</h2>
          <p id={bodyId} className="field-hint">
            Only runs that have no milestone are listed. An attached run keeps
            its cases, results and attachments; it simply counts toward this
            milestone too.
          </p>

          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}

          {serverFieldErrors?.run_ids && (
            <p className="field-error" role="alert">
              {serverFieldErrors.run_ids}
            </p>
          )}

          {loading && (
            <p className="field-hint" role="status">
              Loading runs…
            </p>
          )}

          {!loading && error && (
            <p className="field-error" role="alert">
              {error}
              {onRetry && (
                <>
                  {" "}
                  <button type="button" disabled={busy} onClick={onRetry}>
                    Try again
                  </button>
                </>
              )}
            </p>
          )}

          {!loading && !error && runs.length === 0 && (
            <p className="add-runs-empty">
              No runs without a milestone in this project.
            </p>
          )}

          {runs.length > 0 && (
            <ul className="add-runs-list" id={listId}>
              {runs.map((run) => {
                const checked = selectedIds.has(run.id);
                const errorIndex = selectedRuns.findIndex(
                  (selected) => selected.id === run.id
                );
                const serverError =
                  errorIndex >= 0
                    ? serverFieldErrors?.[`run_ids[${errorIndex}]`]
                    : undefined;
                return (
                  <li className="add-runs-row" key={run.id}>
                    <input
                      type="checkbox"
                      id={`${listId}-${run.id}`}
                      checked={checked}
                      disabled={busy}
                      onChange={() => toggle(run.id)}
                    />
                    <div className="add-runs-main">
                      <label
                        className="add-runs-body"
                        htmlFor={`${listId}-${run.id}`}
                      >
                        <span className="add-runs-name">{run.name}</span>
                        <span className="field-hint">
                          {RUN_STATUS_LABELS[run.status]} ·{" "}
                          {run.counts.percent_complete}% complete
                          {run.due_date
                            ? ` · due ${formatDateOnly(run.due_date)}`
                            : ""}
                        </span>
                      </label>
                      {serverError && (
                        <p className="field-error" role="alert">
                          {serverError}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="button-row dialog-actions">
            <button
              type="submit"
              className="primary"
              disabled={busy || count === 0}
            >
              {busy
                ? "Adding…"
                : count === 0
                  ? "Add runs"
                  : `Add ${count} run${count === 1 ? "" : "s"}`}
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