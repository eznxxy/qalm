"use client";

/**
 * AddToRunDialog — the cases screen's bulk "Add to run…" action
 * (DESIGN §4.2, docs/api-runs.md § POST /runs/:id/items).
 *
 * Only **open** runs are offered: the contract 409s a completed run, and an
 * archived project 409s everything (the caller hides the action there, but the
 * server stays the authority). A case already in the chosen run is skipped by
 * the API rather than rejected, so the dialog's job is to say what happened —
 * `addToRunNotice()` writes that sentence for the page's flash message.
 *
 * The run list is this dialog's own lookup (like RunFormDialog's case search),
 * so it loads here; the write stays with the page, which owns busy/error state.
 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from "react";
import { DisabledHint } from "@/components/ui";
import { api } from "@/lib/endpoints";
import { ApiError } from "@/lib/api-error";
import { isSessionDead } from "@/components/require-auth";
import { formatDateOnly } from "@/lib/dates";
import type { AddRunItemsResult, Run } from "@/lib/api-types";

export interface AddToRunDialogProps {
  projectId: string;
  /** How many rows the bulk bar has selected; named in the body copy. */
  caseCount: number;
  busy?: boolean;
  error?: string | null;
  /** The page names the run in the flash message, so it travels with the id. */
  onSubmit: (runId: string, runName: string) => void;
  onCancel: () => void;
}

/** The select's "nothing chosen" placeholder; real run ids are UUIDs. */
const NO_RUN = "";

type RunsState =
  | { kind: "loading" }
  | { kind: "ready"; runs: Run[] }
  | { kind: "error"; message: string };

export function AddToRunDialog({
  projectId,
  caseCount,
  busy = false,
  error,
  onSubmit,
  onCancel,
}: AddToRunDialogProps): ReactElement {
  const [runsState, setRunsState] = useState<RunsState>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  const [runId, setRunId] = useState<string>(NO_RUN);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setRunsState({ kind: "loading" });
      try {
        const result = await api.listRuns(projectId, { status: "open" });
        if (!active) return;
        setRunsState({ kind: "ready", runs: result.data });
      } catch (err) {
        if (!active || isSessionDead(err)) return;
        setRunsState({
          kind: "error",
          message:
            err instanceof ApiError
              ? err.message
              : "Could not load open runs. Check your connection and retry.",
        });
      }
    })();
    return () => {
      active = false;
    };
  }, [projectId, retry]);

  // Focus trap + Escape, mirroring the other dialogs. Restore focus only when
  // the dialog really left the document: StrictMode's extra teardown in dev
  // would otherwise blur the field the effect just focused.
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
        dialog.querySelectorAll<HTMLElement>(
          "select, button:not(:disabled), a[href]"
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
      if (!dialog?.isConnected) previous?.focus();
    };
  }, [onCancel]);

  const runs = runsState.kind === "ready" ? runsState.runs : [];
  const noRuns = runsState.kind === "ready" && runs.length === 0;

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!runId || busy) return;
    const chosen = runs.find((run) => run.id === runId);
    if (!chosen) return;
    onSubmit(chosen.id, chosen.name);
  }

  return (
    <div className="dialog-overlay">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="dialog add-to-run-dialog"
      >
        <form onSubmit={handleSubmit}>
          <h2 id={titleId}>Add to run</h2>
          <p id={bodyId} className="field-hint">
            Add <strong>{caseCount}</strong> selected case
            {caseCount === 1 ? "" : "s"} to an open run. Cases already in the run
            are skipped.
          </p>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          {runsState.kind === "loading" ? (
            <p role="status">Loading open runs…</p>
          ) : runsState.kind === "error" ? (
            <div className="drawer-state" role="alert">
              <p>{runsState.message}</p>
              <button type="button" onClick={() => setRetry((n) => n + 1)}>
                Retry
              </button>
            </div>
          ) : noRuns ? (
            <p className="field-hint">
              <strong>No open runs in this project.</strong> Create a run first,
              then add cases to it.
            </p>
          ) : (
            <div className="field">
              <label htmlFor="add-to-run-target">Run</label>
              <select
                id="add-to-run-target"
                value={runId}
                disabled={busy}
                onChange={(event) => setRunId(event.target.value)}
              >
                <option value={NO_RUN}>Choose a run…</option>
                {runs.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.due_date
                      ? `${run.name} · due ${formatDateOnly(run.due_date)}`
                      : run.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="button-row dialog-actions">
            <DisabledHint
              hint={
                busy
                  ? "Adding — please wait"
                  : noRuns
                    ? "There is no open run to add to yet"
                    : !runId
                      ? "Choose a run first"
                      : null
              }
            >
              <button
                type="submit"
                className="primary"
                disabled={busy || noRuns || !runId}
              >
                {busy ? "Adding…" : "Add to run"}
              </button>
            </DisabledHint>
            <DisabledHint hint={busy ? "Can't cancel while adding" : null}>
              <button type="button" disabled={busy} onClick={onCancel}>
                {noRuns ? "Close" : "Cancel"}
              </button>
            </DisabledHint>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * The flash line for a finished add: what went in, and what the API skipped
 * because the case was already there (or had been deleted).
 */
export function addToRunNotice(
  result: AddRunItemsResult,
  runName: string
): string {
  const { added, skipped } = result;
  if (added === 0) {
    return `No new cases — ${skipped === 1 ? "that case is" : `all ${skipped} cases are`} already in “${runName}”.`;
  }
  const addedLine = `Added ${added} case${added === 1 ? "" : "s"} to “${runName}”.`;
  if (skipped === 0) return addedLine;
  return `${addedLine} ${skipped} case${skipped === 1 ? " was" : "s were"} already in the run.`;
}